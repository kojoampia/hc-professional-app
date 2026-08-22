import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ConversationDto, MessageDto, MessagingApiService, NewConversationDto, RecipientDto } from '../../core/api/messaging-api.service';
import { MessageSocketService } from '../../core/api/message-socket.service';
import { AppStateService } from '../../core/native/app-state.service';
import { PushService } from '../../core/native/push.service';
import { SecureTokenStore } from '../../core/native/secure-token-store.service';
import { CacheStore } from '../../core/offline/cache-store.service';
import { CachedResource, cachedResource } from '../../core/offline/cached-resource';
import { QueuedWrite } from '../../core/offline/queued-write.model';
import { WriteQueue } from '../../core/offline/write-queue.service';

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
  private readonly queue = inject(WriteQueue);

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
    // Both message writes go through the queue, so a reply typed in a lift is kept rather than
    // lost. The subject id is the conversation for a reply and a generated id for a new thread —
    // FIFO is per (kind, subjectId), so two replies to one thread arrive in the order they were
    // written while a reply to another thread is not held up behind them.
    this.queue.register('message.reply', (write: QueuedWrite) =>
      firstValueFrom(this.api.reply(write.subjectId, write.payload['body'] as string)),
    );
    this.queue.register('message.start', (write: QueuedWrite) =>
      firstValueFrom(this.api.startConversation(write.payload['request'] as NewConversationDto)),
    );

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
      // THIS thread counts as read — not every thread. Until Phase 1 the only endpoints were one
      // message or everything, and this took everything, so opening one conversation cleared every
      // unread badge in the app. The server answers with the new total, so the badge is written
      // from that rather than re-fetched or decremented locally.
      await this.unread.set(await firstValueFrom(this.api.markConversationRead(conversationId)));
    } catch {
      // Offline: whatever was cached stays on screen. The thread is still readable.
    }
  }

  closeThread(): void {
    this.openThreadId.set(null);
    this.threadState.set([]);
  }

  /**
   * Queues a reply.
   *
   * <p>Through the queue rather than straight to the API, so a reply typed with no signal is kept
   * and sent later rather than failing at the send button. The thread is refreshed afterwards only
   * when the op left the queue immediately; otherwise the pending op is what the screen shows.
   */
  async reply(body: string): Promise<QueuedWrite | null> {
    const conversationId = this.openThreadId();
    if (!conversationId || !body.trim()) {
      return null;
    }
    const write = await this.queue.submit('message.reply', conversationId, { body: body.trim() });
    await this.refreshThreadAndList(conversationId);
    return write;
  }

  /**
   * Queues a new thread.
   *
   * <p>The subject id is generated rather than taken from anything on the server, because the
   * conversation does not exist yet. It only has to be unique per op for the queue's per-subject
   * FIFO to mean something.
   */
  async startConversation(request: NewConversationDto): Promise<QueuedWrite | null> {
    if (!request.body.trim()) {
      return null;
    }
    const write = await this.queue.submit('message.start', `new-${request.recipientRole ?? (request.recipientIds ?? []).join(',')}`, {
      request: { ...request, body: request.body.trim() },
    });
    await this.conversations.refresh();
    return write;
  }

  /** Who this clinician may address. Not cached — a directory is not clinical content to keep. */
  async recipients(query?: string, role?: string): Promise<RecipientDto[]> {
    try {
      return await firstValueFrom(this.api.recipients(query, role));
    } catch {
      return [];
    }
  }

  private async refreshThreadAndList(conversationId: string): Promise<void> {
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
