import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ConversationDto, MessageDto, MessagingApiService } from '../../core/api/messaging-api.service';
import { MessageSocketService } from '../../core/api/message-socket.service';
import { AppStateService } from '../../core/native/app-state.service';
import { PushService } from '../../core/native/push.service';
import { SecureTokenStore } from '../../core/native/secure-token-store.service';
import { CacheStore } from '../../core/offline/cache-store.service';
import { CachedResource, cachedResource } from '../../core/offline/cached-resource';

const CONVERSATIONS_TTL_MS = 5 * 60 * 1000;

/** How long after backgrounding the socket is dropped. */
const SOCKET_IDLE_GRACE_MS = 30_000;

/** How many message ids to remember for deduplication. */
const SEEN_LIMIT = 200;

/**
 * The inbox.
 *
 * <h3>Why a notification does not carry the message</h3>
 * The socket relays identifiers only, and this store then fetches the message over
 * HTTP. That second hop is not redundant: the read goes through the same
 * authorization check as any other request, so a frame naming something the caller
 * may not read simply yields nothing. The same discipline applies to push (MOB10).
 *
 * <h3>Why dedupe</h3>
 * The server sends push **and** STOMP for every message — it cannot reliably know
 * whether a socket is live, and guessing produces missed notifications. So both
 * always fire and the client is responsible for not counting a message twice.
 */
@Injectable({ providedIn: 'root' })
export class MessagesStore {
  private readonly api = inject(MessagingApiService);
  private readonly socket = inject(MessageSocketService);
  private readonly cache = inject(CacheStore);
  private readonly appState = inject(AppStateService);
  private readonly push = inject(PushService);
  private readonly tokens = inject(SecureTokenStore);

  readonly conversations: CachedResource<ConversationDto[]> = cachedResource(this.cache, {
    key: 'messaging.conversations',
    ttlMs: CONVERSATIONS_TTL_MS,
    fetch: () => this.api.conversations(),
  });

  readonly unread: CachedResource<number> = cachedResource(this.cache, {
    key: 'messaging.unreadCount',
    ttlMs: CONVERSATIONS_TTL_MS,
    fetch: () => this.api.unreadCount(),
  });

  private readonly openThreadId = signal<string | null>(null);
  private readonly threadState = signal<readonly MessageDto[]>([]);
  readonly thread = computed(() => this.threadState());
  readonly openConversationId = this.openThreadId.asReadonly();

  readonly socketState = this.socket.state;

  /** Recently handled message ids, newest last. Bounded so it cannot grow forever. */
  private readonly seen: string[] = [];

  private backgroundTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  constructor() {
    // Reconnect whenever the access token changes — a refresh mints a new one every
    // 15 minutes, and the socket must present the current one or the server drops it.
    effect(() => {
      const token = this.tokens.accessToken();
      if (this.started && token) {
        this.socket.reconnect();
      }
    });
  }

  /** Called once when the inbox becomes reachable. Idempotent. */
  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;

    this.socket.notifications.subscribe(notification => void this.onNotification(notification.messageId));
    await this.appState.initialize();
    this.appState.onChange(active => void this.onAppStateChange(active));

    this.socket.connect();
    await this.refresh();
  }

  /** Tears everything down on sign-out. */
  stop(): void {
    this.started = false;
    this.clearBackgroundTimer();
    this.socket.disconnect();
    this.seen.length = 0;
    this.threadState.set([]);
    this.openThreadId.set(null);
  }

  async refresh(): Promise<void> {
    await Promise.all([this.conversations.refresh(), this.unread.refresh()]);
  }

  /** Opens a thread. Bodies are cached sealed, since they carry clinical content. */
  async openThread(conversationId: string): Promise<void> {
    this.openThreadId.set(conversationId);

    const key = `messaging.thread.${conversationId}`;
    const cached = await this.cache.get<MessageDto[]>(key);
    if (cached) {
      this.threadState.set(cached.value);
    }

    try {
      const messages = await firstValueFrom(this.api.messagesIn(conversationId));
      this.threadState.set(messages);
      await this.cache.setSensitive(key, messages);
      // Everything on screen counts as read; the server is the source of truth for
      // the badge, so re-read rather than decrementing locally.
      await firstValueFrom(this.api.markAllRead());
      await this.unread.refresh();
    } catch {
      // Offline: whatever was cached stays on screen. The thread is still readable.
    }
  }

  closeThread(): void {
    this.openThreadId.set(null);
    this.threadState.set([]);
  }

  async reply(body: string): Promise<void> {
    const conversationId = this.openThreadId();
    if (!conversationId || !body.trim()) {
      return;
    }
    await firstValueFrom(this.api.reply(conversationId, body.trim()));
    await this.openThread(conversationId);
    await this.conversations.refresh();
  }

  /**
   * Handles an inbound notification from either transport.
   *
   * @returns whether it was acted on. False means it was a duplicate.
   */
  async onNotification(messageId: string): Promise<boolean> {
    if (this.seen.includes(messageId)) {
      return false;
    }
    this.seen.push(messageId);
    if (this.seen.length > SEEN_LIMIT) {
      this.seen.splice(0, this.seen.length - SEEN_LIMIT);
    }

    await Promise.all([this.unread.refresh(), this.conversations.refresh()]);
    const open = this.openThreadId();
    if (open) {
      await this.openThread(open);
    }
    return true;
  }

  private async onAppStateChange(active: boolean): Promise<void> {
    if (active) {
      this.clearBackgroundTimer();
      this.socket.connect();
      // Anything that arrived while away was missed by the socket, and the server's
      // count is authoritative — the tray is not.
      await this.unread.refresh();
      await this.conversations.refresh();
      await this.push.clearDelivered();
      return;
    }

    // Hold the socket briefly: a glance at the notification shade or a quick app
    // switch should not cost a reconnect. Past the grace period push takes over.
    this.clearBackgroundTimer();
    this.backgroundTimer = setTimeout(() => this.socket.disconnect(), SOCKET_IDLE_GRACE_MS);
  }

  private clearBackgroundTimer(): void {
    if (this.backgroundTimer !== null) {
      clearTimeout(this.backgroundTimer);
      this.backgroundTimer = null;
    }
  }
}
