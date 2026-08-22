import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { AppStateService } from '../native/app-state.service';
import { NetworkService } from '../native/network.service';
import { PlatformService } from '../native/platform.service';
import { PreferencesService } from '../native/preferences.service';
import { SecureTokenStore } from '../native/secure-token-store.service';
import { CacheStore } from './cache-store.service';
import { QueuedWrite } from './queued-write.model';
import { WriteQueue } from './write-queue.service';

const disk = new Map<string, unknown>();
jest.mock('idb-keyval', () => ({
  get: jest.fn(async (key: string) => disk.get(key)),
  set: jest.fn(async (key: string, value: unknown) => void disk.set(key, value)),
  del: jest.fn(async (key: string) => void disk.delete(key)),
  keys: jest.fn(async () => [...disk.keys()]),
  clear: jest.fn(async () => disk.clear()),
}));

/**
 * The offline write queue.
 *
 * <p>Its rules are the whole safety argument, so each one is asserted on its own rather than
 * through a happy path that happens to exercise several: a clinical note that is silently lost,
 * silently duplicated, or reported as sent when it was not, is the class of failure this exists to
 * prevent, and each of those has a different cause.
 */
/** Keeps the AES key across a simulated restart; a stub that forgets it makes the queue unreadable. */
const secrets = new Map<string, string>();
/** Survives the simulated restart too: a fresh Preferences map reads as a NEW OWNER and wipes the cache. */
const preferences = new Map<string, string>();
const preferencesStore = {
  get: async (key: string) => preferences.get(key) ?? null,
  set: async (key: string, value: string) => void preferences.set(key, value),
  remove: async (key: string) => void preferences.delete(key),
};
const secretStore = {
  readSecret: async (key: string) => secrets.get(key) ?? null,
  writeSecret: async (key: string, value: string) => void secrets.set(key, value),
};

describe('WriteQueue', () => {
  let queue: WriteQueue;
  const connected = signal(true);
  let appStateListeners: ((active: boolean) => void)[];
  let ids: number;

  const setup = async (): Promise<void> => {
    disk.clear();
    secrets.clear();
    connected.set(true);
    appStateListeners = [];
    ids = 0;
    preferences.clear();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: NetworkService, useValue: { connected } },
        {
          provide: AppStateService,
          useValue: {
            initialize: async () => undefined,
            onChange: (listener: (active: boolean) => void) => {
              appStateListeners.push(listener);
              return () => undefined;
            },
          },
        },
        // Deterministic ids so assertions can name an op.
        { provide: PlatformService, useValue: { randomId: () => `id-${++ids}`, name: () => 'android', isNative: () => true } },
        { provide: PreferencesService, useValue: preferencesStore },
        { provide: SecureTokenStore, useValue: secretStore },
      ],
    });
    await TestBed.inject(CacheStore).initialize('nurse');
    queue = TestBed.inject(WriteQueue);
    await queue.start();
  };

  beforeEach(setup);

  const httpError = (status: number, detail = 'nope'): HttpErrorResponse =>
    new HttpErrorResponse({ status, error: { detail }, statusText: 'x' });

  it('sends immediately when there is a connection, and keeps nothing behind', async () => {
    const sender = jest.fn().mockResolvedValue({});
    queue.register('activity.append', sender);

    await queue.submit('activity.append', 'p1', { title: 'Wound dressed' });

    expect(sender).toHaveBeenCalledTimes(1);
    expect(queue.isEmpty()).toBe(true);
  });

  it('HOLDS a write while offline instead of failing it', async () => {
    connected.set(false);
    const sender = jest.fn().mockResolvedValue({});
    queue.register('activity.append', sender);

    await queue.submit('activity.append', 'p1', { title: 'Wound dressed' });

    expect(sender).not.toHaveBeenCalled();
    expect(queue.pending()).toHaveLength(1);
  });

  it('sends what it held once the signal comes back', async () => {
    connected.set(false);
    const sender = jest.fn().mockResolvedValue({});
    queue.register('activity.append', sender);
    await queue.submit('activity.append', 'p1', { title: 'Wound dressed' });

    connected.set(true);
    TestBed.flushEffects();
    // drain() awaits the pass the effect already started, so this is deterministic rather than a
    // guess about how long the phone needed.
    await queue.drain();

    expect(sender).toHaveBeenCalledTimes(1);
    expect(queue.isEmpty()).toBe(true);
  });

  it('sends what it held when the app is resumed, which a sleeping phone needs', async () => {
    // A phone that was asleep missed the connectivity edge entirely.
    connected.set(false);
    const sender = jest.fn().mockResolvedValue({});
    queue.register('activity.append', sender);
    await queue.submit('activity.append', 'p1', {});
    connected.set(true);

    appStateListeners.forEach(listener => listener(true));
    await queue.drain();

    expect(sender).toHaveBeenCalled();
  });

  it('SURVIVES a restart with the write intact', async () => {
    connected.set(false);
    queue.register('activity.append', jest.fn());
    await queue.submit('activity.append', 'p1', { title: 'Wound dressed' });

    // Same disk, fresh everything else — a force-quit and relaunch.
    const previous = disk.get('hpd:writeQueue');
    TestBed.resetTestingModule();
    disk.set('hpd:writeQueue', previous);
    connected.set(false);
    TestBed.configureTestingModule({
      providers: [
        { provide: NetworkService, useValue: { connected } },
        { provide: AppStateService, useValue: { initialize: async () => undefined, onChange: () => () => undefined } },
        { provide: PlatformService, useValue: { randomId: () => 'id-x', name: () => 'android', isNative: () => true } },
        { provide: PreferencesService, useValue: preferencesStore },
        { provide: SecureTokenStore, useValue: secretStore },
      ],
    });
    await TestBed.inject(CacheStore).initialize('nurse');
    const revived = TestBed.inject(WriteQueue);
    await revived.start();

    expect(revived.pending()).toHaveLength(1);
    expect(revived.pending()[0].payload['title']).toBe('Wound dressed');
  });

  it('is UNREADABLE on disk — the clinical text never appears in plaintext', async () => {
    connected.set(false);
    queue.register('activity.append', jest.fn());

    await queue.submit('activity.append', 'p1', { title: 'Wound dressing changed', detail: 'No exudate' });

    expect(JSON.stringify(disk.get('hpd:writeQueue'))).not.toContain('exudate');
  });

  it('REPLAYS THE SAME clientRef, so an ambiguous timeout cannot double-file a note', async () => {
    // The request arrived, the response did not. Without a stable key the retry files it twice, and
    // a duplicated observation is invisible until someone reads the record back.
    const sender = jest.fn().mockRejectedValueOnce(httpError(0)).mockResolvedValueOnce({});
    queue.register('activity.append', sender);

    await queue.submit('activity.append', 'p1', {});
    await queue.retry(queue.pending()[0].id);

    const refs = sender.mock.calls.map(call => (call[0] as QueuedWrite).clientRef);
    expect(refs[0]).toBe(refs[1]);
  });

  describe('what the server says, and what happens next', () => {
    it('retries a transport failure and backs off', async () => {
      const sender = jest.fn().mockRejectedValue(httpError(0));
      queue.register('activity.append', sender);

      await queue.submit('activity.append', 'p1', {});

      const [write] = queue.pending();
      expect(write.state).toBe('pending');
      expect(write.attempts).toBe(1);
      expect(write.nextAttemptAt).toBeGreaterThan(Date.now());
    });

    it('retries a 5xx — the write is still good', async () => {
      queue.register('activity.append', jest.fn().mockRejectedValue(httpError(503)));

      await queue.submit('activity.append', 'p1', {});

      expect(queue.pending()[0].state).toBe('pending');
    });

    it('retries a 401, because that is not the op failing', async () => {
      // authRefreshInterceptor refreshes and the replay carries the new token.
      queue.register('activity.append', jest.fn().mockRejectedValue(httpError(401)));

      await queue.submit('activity.append', 'p1', {});

      expect(queue.pending()[0].state).toBe('pending');
    });

    it('STOPS on a 409 and never auto-merges clinical text', async () => {
      queue.register('case.patch', jest.fn().mockRejectedValue(httpError(409, 'edited by someone else')));

      await queue.submit('case.patch', 'c1', { diagnosis: 'mine' });

      const [write] = queue.needingAttention();
      expect(write.state).toBe('conflict');
      expect(write.lastError).toContain('edited by someone else');
    });

    it('STOPS on a 403 rather than retrying a permissions problem forever', async () => {
      // Retrying would hide it behind a spinner until the op expired.
      queue.register('activity.append', jest.fn().mockRejectedValue(httpError(403)));

      await queue.submit('activity.append', 'p1', {});

      expect(queue.needingAttention()[0].state).toBe('rejected');
    });

    it('stops on a 422, which is the refused-broadcast case', async () => {
      queue.register('message.start', jest.fn().mockRejectedValue(httpError(422)));

      await queue.submit('message.start', 'new', {});

      expect(queue.needingAttention()[0].state).toBe('rejected');
    });
  });

  describe('ordering', () => {
    it('COLLAPSES consecutive edits to one case — last write wins', async () => {
      connected.set(false);
      queue.register('case.patch', jest.fn());

      await queue.submit('case.patch', 'c1', { diagnosis: 'first' });
      await queue.submit('case.patch', 'c1', { diagnosis: 'second' });

      expect(queue.pending()).toHaveLength(1);
      expect(queue.pending()[0].payload['diagnosis']).toBe('second');
    });

    it('does NOT collapse appends — two notes are two events', async () => {
      connected.set(false);
      queue.register('activity.append', jest.fn());

      await queue.submit('activity.append', 'p1', { title: 'first' });
      await queue.submit('activity.append', 'p1', { title: 'second' });

      expect(queue.pending()).toHaveLength(2);
    });

    it('does not collapse edits to DIFFERENT cases', async () => {
      connected.set(false);
      queue.register('case.patch', jest.fn());

      await queue.submit('case.patch', 'c1', {});
      await queue.submit('case.patch', 'c2', {});

      expect(queue.pending()).toHaveLength(2);
    });

    it('sends two notes on one patient IN THE ORDER they were written', async () => {
      // The point is ordering, not throughput. One op per subject goes out at a time, so the second
      // note cannot overtake the first and reorder them in the record; the drain then loops and
      // sends it immediately after.
      connected.set(false);
      const order: string[] = [];
      const sender = jest.fn(async (write: QueuedWrite) => {
        order.push(write.payload['title'] as string);
      });
      queue.register('activity.append', sender);
      await queue.submit('activity.append', 'p1', { title: 'first' });
      await queue.submit('activity.append', 'p1', { title: 'second' });

      connected.set(true);
      await queue.drain();

      expect(order).toEqual(['first', 'second']);
      expect(queue.isEmpty()).toBe(true);
    });

    it('does not hold one patient behind another', async () => {
      connected.set(false);
      const sender = jest.fn().mockResolvedValue({});
      queue.register('activity.append', sender);
      await queue.submit('activity.append', 'p1', {});
      await queue.submit('activity.append', 'p2', {});

      connected.set(true);
      await queue.drain();

      expect(sender).toHaveBeenCalledTimes(2);
    });
  });

  describe('what a person has to decide', () => {
    it('re-arms a conflicted op on retry', async () => {
      const sender = jest.fn().mockRejectedValueOnce(httpError(409)).mockResolvedValueOnce({});
      queue.register('case.patch', sender);
      await queue.submit('case.patch', 'c1', {});

      await queue.retry(queue.needingAttention()[0].id);

      expect(queue.isEmpty()).toBe(true);
    });

    it('drops an op only when told to', async () => {
      queue.register('activity.append', jest.fn().mockRejectedValue(httpError(403)));
      await queue.submit('activity.append', 'p1', {});

      await queue.discard(queue.needingAttention()[0].id);

      expect(queue.isEmpty()).toBe(true);
    });

    it('warns once something has failed', async () => {
      queue.register('activity.append', jest.fn().mockRejectedValue(httpError(403)));
      await queue.submit('activity.append', 'p1', {});

      expect(queue.shouldWarn()).toBe(true);
    });

    it('does NOT warn about a note written moments ago', async () => {
      // A clinician in a lift is normal; a banner about it is noise.
      connected.set(false);
      queue.register('activity.append', jest.fn());
      await queue.submit('activity.append', 'p1', {});

      expect(queue.shouldWarn()).toBe(false);
    });
  });

  it('holds an op whose sender is not registered rather than dropping it', async () => {
    // A wiring fault is not the clinician's, and the sender probably exists next launch.
    await queue.submit('report.append', 'p1', { name: 'x' });

    expect(queue.pending()).toHaveLength(1);
  });
});
