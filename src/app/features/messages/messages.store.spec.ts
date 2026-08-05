import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { of, throwError } from 'rxjs';
import { signal } from '@angular/core';

import { MessageNotification, MessageSocketService } from '../../core/api/message-socket.service';
import { MessagingApiService } from '../../core/api/messaging-api.service';
import { AppStateService } from '../../core/native/app-state.service';
import { PushService } from '../../core/native/push.service';
import { PreferencesService } from '../../core/native/preferences.service';
import { SecureTokenStore } from '../../core/native/secure-token-store.service';
import { CacheStore } from '../../core/offline/cache-store.service';
import { MessagesStore } from './messages.store';

const disk = new Map<string, unknown>();
jest.mock('idb-keyval', () => ({
  get: jest.fn(async (key: string) => disk.get(key)),
  set: jest.fn(async (key: string, value: unknown) => void disk.set(key, value)),
  del: jest.fn(async (key: string) => void disk.delete(key)),
  keys: jest.fn(async () => [...disk.keys()]),
  clear: jest.fn(async () => disk.clear()),
}));

describe('MessagesStore', () => {
  let store: MessagesStore;
  let tokens: SecureTokenStore;
  let appState: AppStateService;
  let notifications: Subject<MessageNotification>;

  let socket: {
    connect: jest.Mock;
    disconnect: jest.Mock;
    reconnect: jest.Mock;
    notifications: Subject<MessageNotification>;
    state: unknown;
  };
  let api: {
    conversations: jest.Mock;
    unreadCount: jest.Mock;
    messagesIn: jest.Mock;
    reply: jest.Mock;
    markAllRead: jest.Mock;
  };
  let push: { clearDelivered: jest.Mock };

  const conversation = { id: 'c1', subject: 'Ward handover', lastMessageAt: '2026-08-05T09:00:00Z' };
  const message = { id: 'm1', conversationId: 'c1', senderId: 'other', body: 'Patient stable', sentAt: '2026-08-05T09:00:00Z' };

  beforeEach(async () => {
    jest.useFakeTimers();
    disk.clear();
    notifications = new Subject<MessageNotification>();

    socket = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      reconnect: jest.fn(),
      notifications,
      state: signal('connected'),
    };
    api = {
      conversations: jest.fn(() => of([conversation])),
      unreadCount: jest.fn(() => of(2)),
      messagesIn: jest.fn(() => of([message])),
      reply: jest.fn(() => of(message)),
      markAllRead: jest.fn(() => of(0)),
    };
    push = { clearDelivered: jest.fn(async () => undefined) };

    const prefs = new Map<string, string>();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: MessageSocketService, useValue: socket },
        { provide: MessagingApiService, useValue: api },
        { provide: PushService, useValue: push },
        {
          provide: PreferencesService,
          useValue: {
            get: async (key: string) => prefs.get(key) ?? null,
            set: async (key: string, value: string) => void prefs.set(key, value),
          },
        },
      ],
    });

    await TestBed.inject(CacheStore).initialize('nurse');
    tokens = TestBed.inject(SecureTokenStore);
    appState = TestBed.inject(AppStateService);
    jest.spyOn(appState, 'initialize').mockResolvedValue(undefined);

    tokens.setAccessToken('token-1', 900);
    store = TestBed.inject(MessagesStore);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('start', () => {
    it('connects the socket and loads the inbox', async () => {
      await store.start();

      expect(socket.connect).toHaveBeenCalled();
      expect(store.conversations.value()).toEqual([conversation]);
      expect(store.unread.value()).toBe(2);
    });

    it('is idempotent', async () => {
      await store.start();
      socket.connect.mockClear();
      await store.start();

      expect(socket.connect).not.toHaveBeenCalled();
    });
  });

  describe('inbound notifications', () => {
    beforeEach(() => store.start());

    it('refreshes the badge and the thread list', async () => {
      api.unreadCount.mockReturnValue(of(7));
      await store.onNotification('m-new');

      expect(store.unread.value()).toBe(7);
      expect(api.conversations).toHaveBeenCalledTimes(2);
    });

    it('DEDUPES a message id it has already handled', async () => {
      // The server sends push AND STOMP for every message — it cannot know whether a
      // socket is live, so both always fire and the client must not double count.
      await expect(store.onNotification('m-dup')).resolves.toBe(true);
      await expect(store.onNotification('m-dup')).resolves.toBe(false);
    });

    it('still handles a different message after a duplicate', async () => {
      await store.onNotification('m-a');
      await store.onNotification('m-a');
      await expect(store.onNotification('m-b')).resolves.toBe(true);
    });

    it('bounds the dedupe list so it cannot grow forever', async () => {
      for (let i = 0; i < 250; i++) {
        await store.onNotification(`m-${i}`);
      }
      // The oldest have been evicted, so an old id is treated as new again. That is
      // the accepted trade: a bounded list cannot remember everything, and
      // re-handling a 250-messages-ago notification is harmless.
      await expect(store.onNotification('m-0')).resolves.toBe(true);
      await expect(store.onNotification('m-249')).resolves.toBe(false);
    });

    it('reloads the open thread when a message arrives for it', async () => {
      await store.openThread('c1');
      api.messagesIn.mockClear();

      await store.onNotification('m-new');

      expect(api.messagesIn).toHaveBeenCalledWith('c1');
    });

    it('routes STOMP frames through the same dedupe path', async () => {
      notifications.next({ messageId: 'm-socket' });
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(0);

      await expect(store.onNotification('m-socket')).resolves.toBe(false);
    });
  });

  describe('threads', () => {
    beforeEach(() => store.start());

    it('loads messages and marks the conversation read', async () => {
      await store.openThread('c1');

      expect(store.thread()).toEqual([message]);
      // No per-conversation read endpoint exists, so opening a thread clears
      // everything. Noted as a Phase 2 backend gap.
      expect(api.markAllRead).toHaveBeenCalled();
      // The badge is re-read from the server rather than decremented locally: only
      // the server knows the true count.
      expect(api.unreadCount).toHaveBeenCalledTimes(2);
    });

    it('caches bodies SEALED, since they carry clinical content', async () => {
      await store.openThread('c1');

      const raw = JSON.stringify(disk.get('hpd:messaging.thread.c1'));
      expect(raw).not.toContain('Patient stable');
      expect(raw).toContain('"v":1');
    });

    it('shows cached messages when the network fails', async () => {
      await store.openThread('c1');
      store.closeThread();

      api.messagesIn.mockReturnValue(throwError(() => new Error('offline')));
      await store.openThread('c1');

      expect(store.thread()).toEqual([message]);
    });

    it('clears the thread on close', async () => {
      await store.openThread('c1');
      store.closeThread();

      expect(store.thread()).toEqual([]);
      expect(store.openConversationId()).toBeNull();
    });
  });

  describe('replying', () => {
    beforeEach(() => store.start());

    it('posts and reloads the thread', async () => {
      await store.openThread('c1');
      await store.reply('  on my way  ');

      expect(api.reply).toHaveBeenCalledWith('c1', 'on my way');
    });

    it('ignores an empty draft', async () => {
      await store.openThread('c1');
      await store.reply('   ');

      expect(api.reply).not.toHaveBeenCalled();
    });

    it('does nothing when no thread is open', async () => {
      await store.reply('hello');
      expect(api.reply).not.toHaveBeenCalled();
    });
  });

  describe('app lifecycle', () => {
    beforeEach(() => store.start());

    it('holds the socket briefly on background rather than dropping it instantly', async () => {
      socket.disconnect.mockClear();
      appState.apply(false);

      // A glance at the notification shade must not cost a reconnect.
      jest.advanceTimersByTime(29_000);
      expect(socket.disconnect).not.toHaveBeenCalled();

      jest.advanceTimersByTime(2_000);
      expect(socket.disconnect).toHaveBeenCalled();
    });

    it('cancels the teardown if the app comes back quickly', async () => {
      socket.disconnect.mockClear();
      appState.apply(false);
      jest.advanceTimersByTime(10_000);
      appState.apply(true);
      await jest.advanceTimersByTimeAsync(30_000);

      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('on resume reconnects, re-reads the AUTHORITATIVE count, and clears the tray', async () => {
      appState.apply(false);
      jest.advanceTimersByTime(31_000);
      socket.connect.mockClear();
      api.unreadCount.mockReturnValue(of(9));

      appState.apply(true);
      await jest.advanceTimersByTimeAsync(0);

      expect(socket.connect).toHaveBeenCalled();
      expect(store.unread.value()).toBe(9);
      expect(push.clearDelivered).toHaveBeenCalled();
    });
  });

  describe('token rotation', () => {
    it('RECONNECTS when the access token changes', async () => {
      // The mobile access token expires every 15 minutes. A socket still presenting
      // the old one is dropped by the server, and the inbox silently stops updating.
      await store.start();
      socket.reconnect.mockClear();

      tokens.setAccessToken('token-2', 900);
      TestBed.flushEffects();

      expect(socket.reconnect).toHaveBeenCalled();
    });

    it('does not reconnect before the inbox has started', () => {
      tokens.setAccessToken('token-2', 900);
      TestBed.flushEffects();

      expect(socket.reconnect).not.toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('drops the socket and forgets everything', async () => {
      await store.start();
      await store.openThread('c1');

      store.stop();

      expect(socket.disconnect).toHaveBeenCalled();
      expect(store.thread()).toEqual([]);
      expect(store.openConversationId()).toBeNull();
      // The dedupe list is cleared too, so a new session starts clean.
      await expect(store.onNotification('m1')).resolves.toBe(true);
    });
  });
});
