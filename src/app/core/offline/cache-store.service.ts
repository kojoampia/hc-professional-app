import { Injectable, inject } from '@angular/core';
import { clear as idbClear, del as idbDel, get as idbGet, keys as idbKeys, set as idbSet } from 'idb-keyval';

import { PreferencesService } from '../native/preferences.service';
import { CacheCryptoService, isSealed } from './cache-crypto.service';

/**
 * Bumped by hand whenever a cached DTO shape changes.
 *
 * This is the substitute for schema migrations: there is no server-side notion of
 * a client cache version, so a mismatch on boot clears everything rather than
 * risking a decode of last release's shape into this release's types.
 */
export const CACHE_VERSION = 1;

const VERSION_KEY = 'hpd.cacheVersion';
const OWNER_KEY = 'hpd.cacheOwner';

/** A cached entry with the bookkeeping the UI needs to describe its own staleness. */
export interface CacheEntry<T> {
  value: T;
  /** Epoch millis of the write that produced this value. */
  fetchedAt: number;
}

/**
 * The offline read cache.
 *
 * IndexedDB rather than Capacitor Preferences (which is `SharedPreferences` /
 * `NSUserDefaults` — for scalars, not collections) and rather than SQLite (a native
 * dependency on two platforms plus a web shim, for four small collections and no
 * offline writes; revisit at Phase 2).
 *
 * <h3>Invalidation</h3>
 * `api/` offers no ETags, no pagination and no `X-Total-Count`, so there is nothing
 * to diff against. Every fetch returns a whole collection and is written whole —
 * which means there is no merge problem, and no partial state to reason about.
 * Staleness is advisory: a TTL decides what the UI *says*, never whether the cache
 * is readable. A cache that refuses to serve stale data when the network is down is
 * not an offline cache.
 *
 * <h3>What is encrypted</h3>
 * Entries written through {@link setSensitive} are sealed with AES-GCM. Roster and
 * document metadata are stored in the clear so the shell can render before the
 * keystore is unlocked; message bodies and anything else carrying clinical content
 * go through the sealed path.
 */
@Injectable({ providedIn: 'root' })
export class CacheStore {
  private readonly crypto = inject(CacheCryptoService);
  private readonly preferences = inject(PreferencesService);

  private ready: Promise<void> | null = null;

  /**
   * Discards everything if the cache belongs to a previous release or a different
   * account. Idempotent, and awaited by every read and write.
   *
   * The owner check matters more than it looks: two clinicians sharing a device is
   * ordinary in a ward, and serving one of them the other's cached roster would be
   * a data leak dressed up as a performance optimisation.
   */
  async initialize(owner: string | null): Promise<void> {
    this.ready ??= this.reconcile(owner);
    return this.ready;
  }

  private async reconcile(owner: string | null): Promise<void> {
    const [storedVersion, storedOwner] = await Promise.all([this.preferences.get(VERSION_KEY), this.preferences.get(OWNER_KEY)]);

    const versionChanged = storedVersion !== String(CACHE_VERSION);
    const ownerChanged = owner !== null && storedOwner !== null && storedOwner !== owner;

    if (versionChanged || ownerChanged) {
      await this.clear();
    }

    await this.preferences.set(VERSION_KEY, String(CACHE_VERSION));
    if (owner !== null) {
      await this.preferences.set(OWNER_KEY, owner);
    }
  }

  /** Reads a plain entry. Returns null on a miss or an unreadable value. */
  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const raw = await idbGet(this.namespaced(key));
    if (!raw) {
      return null;
    }
    const entry = raw as CacheEntry<unknown>;
    if (isSealed(entry.value)) {
      const opened = await this.crypto.open<T>(entry.value);
      return opened === null ? null : { value: opened, fetchedAt: entry.fetchedAt };
    }
    return entry as CacheEntry<T>;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await idbSet(this.namespaced(key), { value, fetchedAt: Date.now() } satisfies CacheEntry<T>);
  }

  /** Writes an entry whose contents must not be readable at rest. */
  async setSensitive<T>(key: string, value: T): Promise<void> {
    const sealed = await this.crypto.seal(value);
    await idbSet(this.namespaced(key), { value: sealed, fetchedAt: Date.now() } satisfies CacheEntry<unknown>);
  }

  async remove(key: string): Promise<void> {
    await idbDel(this.namespaced(key));
  }

  /**
   * Wipes the cache and forgets the encryption key.
   *
   * Called on sign-out and on account change. Deliberately does not clear the
   * version/owner markers — the next `initialize` rewrites them, and leaving them
   * means a failure partway through does not resurrect a stale cache as "fresh".
   */
  async clear(): Promise<void> {
    const ours = (await idbKeys()).filter((key): key is string => typeof key === 'string' && key.startsWith('hpd:'));
    await Promise.all(ours.map(key => idbDel(key)));
    this.crypto.forget();
  }

  /** Test seam: drops the memoised initialize so a spec can re-run reconciliation. */
  resetForTesting(): void {
    this.ready = null;
  }

  /** Nukes everything in the database, ours or not. Only for a hard reset. */
  async clearAll(): Promise<void> {
    await idbClear();
    this.crypto.forget();
  }

  private namespaced(key: string): string {
    return `hpd:${key}`;
  }
}
