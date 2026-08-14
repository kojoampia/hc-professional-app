import { TestBed } from '@angular/core/testing';
import { get as idbGet, keys as idbKeys } from 'idb-keyval';

import { PreferencesService } from '../native/preferences.service';
import { CACHE_VERSION, CacheStore } from './cache-store.service';
import { cachedResource, describeAge } from './cached-resource';
import { of, throwError } from 'rxjs';

/**
 * In-memory stand-ins for IndexedDB and Preferences.
 *
 * jsdom has no IndexedDB, and `idb-keyval` is mocked rather than shimmed so the
 * spec can inspect exactly what landed on disk — which is the point of the
 * encryption-at-rest assertions below.
 */
const disk = new Map<string, unknown>();
jest.mock('idb-keyval', () => ({
  get: jest.fn(async (key: string) => disk.get(key)),
  set: jest.fn(async (key: string, value: unknown) => void disk.set(key, value)),
  del: jest.fn(async (key: string) => void disk.delete(key)),
  keys: jest.fn(async () => [...disk.keys()]),
  clear: jest.fn(async () => disk.clear()),
}));

describe('CacheStore', () => {
  let cache: CacheStore;
  let prefs: Map<string, string>;

  beforeEach(() => {
    disk.clear();
    prefs = new Map();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: PreferencesService,
          useValue: {
            get: async (key: string) => prefs.get(key) ?? null,
            set: async (key: string, value: string) => void prefs.set(key, value),
            remove: async (key: string) => void prefs.delete(key),
          },
        },
      ],
    });
    cache = TestBed.inject(CacheStore);
  });

  describe('plain entries', () => {
    it('round-trips a value with its fetch timestamp', async () => {
      await cache.initialize('nurse');
      await cache.set('roster.my', [{ id: 'a1' }]);

      const entry = await cache.get<{ id: string }[]>('roster.my');
      expect(entry?.value).toEqual([{ id: 'a1' }]);
      expect(entry?.fetchedAt).toBeGreaterThan(0);
    });

    it('misses cleanly for an unknown key', async () => {
      await cache.initialize('nurse');
      await expect(cache.get('nothing.here')).resolves.toBeNull();
    });

    it('namespaces keys so it can never clear someone else data', async () => {
      await cache.initialize('nurse');
      await cache.set('roster.my', [1]);
      expect([...disk.keys()]).toEqual(['hpd:roster.my']);
    });
  });

  describe('sensitive entries', () => {
    it('is UNREADABLE on disk — the plaintext never appears', async () => {
      // The gate item. Anyone with the app sandbox (a backup, a pulled flash chip)
      // must not be able to read cached clinical content.
      await cache.initialize('nurse');
      const secret = [{ body: 'Patient deteriorating on ward B, please attend' }];
      await cache.setSensitive('messages.thread', secret);

      const raw = JSON.stringify(await idbGet('hpd:messages.thread'));
      expect(raw).not.toContain('deteriorating');
      expect(raw).not.toContain('ward B');
      expect(raw).toContain('"v":1');
      expect(raw).toContain('"iv"');
    });

    it('decrypts back to the original through the store', async () => {
      await cache.initialize('nurse');
      const secret = [{ body: 'Patient deteriorating on ward B' }];
      await cache.setSensitive('messages.thread', secret);

      const entry = await cache.get<typeof secret>('messages.thread');
      expect(entry?.value).toEqual(secret);
    });

    it('uses a DIFFERENT ciphertext each write — no IV reuse', async () => {
      // Reusing an IV under one key breaks AES-GCM outright and leaks plaintext
      // relationships between records.
      await cache.initialize('nurse');
      await cache.setSensitive('a', { body: 'identical' });
      const first = JSON.stringify(await idbGet('hpd:a'));
      await cache.setSensitive('a', { body: 'identical' });
      const second = JSON.stringify(await idbGet('hpd:a'));

      expect(first).not.toEqual(second);
    });

    it('treats an undecryptable entry as a MISS, not an error', async () => {
      // A rotated key or a truncated write must degrade to "no cache", never to a
      // crash on a screen the clinician is trying to read.
      await cache.initialize('nurse');
      await cache.setSensitive('messages.thread', [{ body: 'x' }]);
      disk.set('hpd:messages.thread', { value: { v: 1, iv: 'AAAAAAAAAAAAAAAA', ct: 'bm90LXJlYWw=' }, fetchedAt: Date.now() });

      await expect(cache.get('messages.thread')).resolves.toBeNull();
    });
  });

  describe('wiping', () => {
    it('clears on sign-out', async () => {
      await cache.initialize('nurse');
      await cache.set('roster.my', [1]);
      await cache.clear();

      await expect(cache.get('roster.my')).resolves.toBeNull();
      expect(await idbKeys()).toHaveLength(0);
    });

    it('WIPES when a different account signs in on the same device', async () => {
      // Two clinicians sharing a ward device is ordinary. Serving the second one the
      // first one's cached roster would be a data leak.
      await cache.initialize('nurse');
      await cache.set('roster.my', [{ id: 'nurse-shift' }]);

      cache.resetForTesting();
      await cache.initialize('doctor');

      await expect(cache.get('roster.my')).resolves.toBeNull();
    });

    it('keeps the cache when the SAME account signs in again', async () => {
      await cache.initialize('nurse');
      await cache.set('roster.my', [{ id: 'nurse-shift' }]);

      cache.resetForTesting();
      await cache.initialize('nurse');

      expect((await cache.get<{ id: string }[]>('roster.my'))?.value).toEqual([{ id: 'nurse-shift' }]);
    });

    it('WIPES when CACHE_VERSION moves on', async () => {
      // The substitute for schema migrations: last release's shape must never be
      // decoded into this release's types.
      await cache.initialize('nurse');
      await cache.set('roster.my', [{ id: 'old-shape' }]);

      prefs.set('hpd.cacheVersion', String(CACHE_VERSION - 1));
      cache.resetForTesting();
      await cache.initialize('nurse');

      await expect(cache.get('roster.my')).resolves.toBeNull();
    });

    it('does not wipe on a first run with no prior owner recorded', async () => {
      await cache.initialize(null);
      await cache.set('roster.my', [1]);
      cache.resetForTesting();
      await cache.initialize('nurse');

      expect(await cache.get('roster.my')).not.toBeNull();
    });
  });
});

describe('cachedResource', () => {
  let cache: CacheStore;
  let prefs: Map<string, string>;

  beforeEach(async () => {
    disk.clear();
    prefs = new Map();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: PreferencesService,
          useValue: {
            get: async (key: string) => prefs.get(key) ?? null,
            set: async (key: string, value: string) => void prefs.set(key, value),
          },
        },
      ],
    });
    cache = TestBed.inject(CacheStore);
    await cache.initialize('nurse');
  });

  it('reports fresh data after a successful fetch', async () => {
    const resource = cachedResource(cache, { key: 'k', ttlMs: 1000, fetch: () => of([1, 2]) });
    await resource.refresh();

    expect(resource.value()).toEqual([1, 2]);
    expect(resource.status()).toBe('fresh');
    expect(resource.fetchedAt()).toBeGreaterThan(0);
  });

  it('SERVES CACHED DATA when the fetch fails, and says it is stale', async () => {
    // The heart of the offline contract: a roster that disappears when the signal
    // does is worse than useless. The data is still correct, just old.
    const ok = cachedResource(cache, { key: 'k', ttlMs: 60_000, fetch: () => of([1, 2]) });
    await ok.refresh();

    const offline = cachedResource(cache, { key: 'k', ttlMs: 60_000, fetch: () => throwError(() => new Error('offline')) });
    await offline.refresh();

    expect(offline.value()).toEqual([1, 2]);
    expect(offline.status()).toBe('stale');
  });

  it('reports error ONLY when there is nothing cached at all', async () => {
    const resource = cachedResource(cache, { key: 'empty', ttlMs: 1000, fetch: () => throwError(() => new Error('offline')) });
    await resource.refresh();

    expect(resource.value()).toBeNull();
    expect(resource.status()).toBe('error');
  });

  it('calls cached data stale once past its TTL, without refusing to serve it', async () => {
    const seeded = cachedResource(cache, { key: 'k', ttlMs: 0, fetch: () => of(['x']) });
    await seeded.refresh();

    await new Promise(resolve => setTimeout(resolve, 5));
    const reader = cachedResource(cache, { key: 'k', ttlMs: 1, fetch: () => throwError(() => new Error('offline')) });
    await reader.refresh();

    expect(reader.value()).toEqual(['x']);
    expect(reader.status()).toBe('stale');
  });

  it('replaces the whole collection rather than merging', async () => {
    const first = cachedResource(cache, { key: 'k', ttlMs: 1000, fetch: () => of([1, 2, 3]) });
    await first.refresh();
    const second = cachedResource(cache, { key: 'k', ttlMs: 1000, fetch: () => of([9]) });
    await second.refresh();

    expect((await cache.get<number[]>('k'))?.value).toEqual([9]);
  });

  it('seals sensitive resources on the way to disk', async () => {
    const resource = cachedResource(cache, {
      key: 'secret',
      ttlMs: 1000,
      sensitive: true,
      fetch: () => of([{ body: 'confidential note' }]),
    });
    await resource.refresh();

    expect(JSON.stringify(await idbGet('hpd:secret'))).not.toContain('confidential');
    expect(resource.value()).toEqual([{ body: 'confidential note' }]);
  });

  it('never rejects — a failed refresh must not blow up a screen', async () => {
    const resource = cachedResource(cache, { key: 'k', ttlMs: 1000, fetch: () => throwError(() => new Error('boom')) });
    await expect(resource.refresh()).resolves.toBeUndefined();
  });
});

describe('describeAge', () => {
  const now = Date.UTC(2026, 7, 5, 12, 0, 0);

  // Keys and counts, not sentences: the wording lives in the catalogues so it can be translated,
  // and this asserts only the arithmetic that decides which bucket an age falls in.
  it.each([
    [null, { key: 'common.ageNever' }],
    [now - 5_000, { key: 'common.ageJustNow' }],
    [now - 12 * 60_000, { key: 'common.ageMinutes', params: { count: 12 } }],
    [now - 3 * 3_600_000, { key: 'common.ageHours', params: { count: 3 } }],
    [now - 2 * 86_400_000, { key: 'common.ageDays', params: { count: 2 } }],
  ])('%s reads as %s', (fetchedAt, expected) => {
    expect(describeAge(fetchedAt as number | null, now)).toEqual(expected);
  });

  it('never reports a negative age from clock skew', () => {
    expect(describeAge(now + 60_000, now)).toEqual({ key: 'common.ageJustNow' });
  });
});
