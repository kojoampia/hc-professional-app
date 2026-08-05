import { Signal, signal } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';

import { CacheStore } from './cache-store.service';

/** How the UI should describe what it is showing. */
export type ResourceStatus =
  /** Nothing loaded yet. */
  | 'idle'
  /** A network request is in flight. */
  | 'loading'
  /** Showing live data. */
  | 'fresh'
  /** Showing cached data — either older than its TTL, or the refresh failed. */
  | 'stale'
  /** No cached data and the request failed. */
  | 'error';

export interface CachedResource<T> {
  readonly value: Signal<T | null>;
  readonly status: Signal<ResourceStatus>;
  /** Epoch millis of the data currently displayed, or null if none. */
  readonly fetchedAt: Signal<number | null>;
  /** Renders cache first, then revalidates. Never rejects. */
  refresh(): Promise<void>;
}

export interface CachedResourceOptions<T> {
  key: string;
  /** How long before the UI should call the data stale. Advisory only — never a hard miss. */
  ttlMs: number;
  fetch: () => Observable<T>;
  /** True for anything carrying clinical content; seals the entry at rest. */
  sensitive?: boolean;
}

/**
 * Stale-while-revalidate over {@link CacheStore}.
 *
 * The contract is deliberately asymmetric: **cached data is always served**, and the
 * TTL only decides whether the UI calls it stale. A network failure downgrades the
 * status and leaves the value in place; it never blanks the screen. A clinician on
 * a ward with no signal should see this morning's roster marked "updated 2 h ago",
 * not an error — the data is still correct, just old, and a roster that disappears
 * when the signal does is worse than useless.
 *
 * `error` is therefore reachable only when there is nothing cached at all.
 */
export function cachedResource<T>(cache: CacheStore, options: CachedResourceOptions<T>): CachedResource<T> {
  const value = signal<T | null>(null);
  const status = signal<ResourceStatus>('idle');
  const fetchedAt = signal<number | null>(null);

  const readCache = async (): Promise<boolean> => {
    const entry = await cache.get<T>(options.key);
    if (!entry) {
      return false;
    }
    value.set(entry.value);
    fetchedAt.set(entry.fetchedAt);
    status.set(Date.now() - entry.fetchedAt > options.ttlMs ? 'stale' : 'fresh');
    return true;
  };

  const refresh = async (): Promise<void> => {
    const hadCache = value() !== null || (await readCache());
    status.set(hadCache ? status() : 'loading');

    try {
      const fresh = await firstValueFrom(options.fetch());
      // Whole-collection replace: every fetch returns the complete list, so there is
      // nothing to merge and no partial state to reconcile.
      if (options.sensitive) {
        await cache.setSensitive(options.key, fresh);
      } else {
        await cache.set(options.key, fresh);
      }
      value.set(fresh);
      fetchedAt.set(Date.now());
      status.set('fresh');
    } catch {
      // Offline, timeout, 5xx — keep whatever we have and say so.
      status.set(hadCache ? 'stale' : 'error');
    }
  };

  return { value: value.asReadonly(), status: status.asReadonly(), fetchedAt: fetchedAt.asReadonly(), refresh };
}

/** "just now" / "12 min ago" / "3 h ago" — what the staleness chip shows. */
export function describeAge(fetchedAt: number | null, now: number = Date.now()): string {
  if (fetchedAt === null) {
    return 'never';
  }
  const seconds = Math.max(0, Math.round((now - fetchedAt) / 1000));
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  return `${Math.round(hours / 24)} d ago`;
}
