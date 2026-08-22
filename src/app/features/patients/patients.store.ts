import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { PatientApiService, PatientListItemDto, PatientRecordDto } from '../../core/api/patient-api.service';
import { CacheStore } from '../../core/offline/cache-store.service';
import { QueuedWrite } from '../../core/offline/queued-write.model';
import { WriteQueue } from '../../core/offline/write-queue.service';
import { ResourceStatus } from '../../core/offline/cached-resource';

/** Where the offline copy of page zero lives. */
const FIRST_PAGE_KEY = 'patients.firstPage';

/** Rows per request. Twenty fills a phone screen twice over and costs little on mobile data. */
export const PAGE_SIZE = 20;

/** A caseload changes when an administrator assigns work — rarely, and never on the minute. */
const DIRECTORY_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * How many opened records are kept.
 *
 * <p>Bounded on purpose. Every one is clinical content sealed at rest, and an unbounded set means a
 * long career quietly fills the app sandbox with patient records — a privacy cost that grows with
 * use and that nobody would ever notice.
 */
export const RECORD_CACHE_LIMIT = 20;

/** An entry a clinician has written that has not reached the server yet. */
export interface PendingEntry {
  write: QueuedWrite;
  patientId: string;
  kind: 'activity' | 'report';
  label: string;
}

/** Filters the directory offers, matching the two the web dashboard has. */
export interface PatientFilters {
  query: string;
  sex: string | null;
  childrenOnly: boolean;
}

/**
 * The clinician's patient directory and the records they have opened.
 *
 * <h3>Page 1 is cached; pages 2+ are not</h3>
 * `cachedResource`'s contract is whole-collection replace — every fetch returns the complete list,
 * so there is nothing to merge. Paged data breaks that, and rather than bend the primitive this
 * store caches the **first page only** and treats the rest as online-only.
 *
 * <p>That is not a compromise so much as a reading of what offline is actually for here. Nobody
 * needs page seven of a patient list in a basement. What they need is *the patients they have
 * opened*, and those are cached individually and sealed — see {@link openRecord}.
 *
 * <h3>Filtering is server-side</h3>
 * Unlike `web/`, which loads the caseload eagerly and filters in the browser. A phone cannot afford
 * that, and the endpoint learned `query`, `sex` and `childrenOnly` in Phase 1.1 precisely so it
 * would not have to.
 */
@Injectable({ providedIn: 'root' })
export class PatientsStore {
  private readonly api = inject(PatientApiService);
  private readonly cache = inject(CacheStore);
  private readonly queue = inject(WriteQueue);

  private readonly filtersSignal = signal<PatientFilters>({ query: '', sex: null, childrenOnly: false });
  readonly filters = this.filtersSignal.asReadonly();

  /**
   * When the cached first page was written, for the staleness banner.
   *
   * <p>The cache is managed by hand here rather than through `cachedResource`, and the reason is
   * worth stating: that helper owns its own fetch, so pairing it with a paged list meant asking the
   * server for page zero <b>twice</b> on every refresh — once for the list, once for the cache. On
   * mobile data that is precisely the waste Phase 1.1's paging exists to avoid. Page zero is now
   * written into the cache from the response already in hand.
   */
  private readonly cachedAtSignal = signal<number | null>(null);

  private readonly rowsSignal = signal<readonly PatientListItemDto[]>([]);
  readonly rows = computed(() => this.rowsSignal());

  private readonly totalSignal = signal(0);
  readonly total = this.totalSignal.asReadonly();

  private readonly loadingSignal = signal(false);
  readonly loading = this.loadingSignal.asReadonly();

  private readonly failedSignal = signal(false);
  readonly failed = this.failedSignal.asReadonly();

  private nextPage = 0;

  /** Whether another page exists. Drives the infinite scroll's own disabled state. */
  readonly hasMore = computed(() => this.rowsSignal().length < this.totalSignal());

  /** What the shared empty row and banner read. */
  readonly status = computed<ResourceStatus>(() => {
    if (this.rowsSignal().length === 0) {
      return this.failedSignal() ? 'error' : 'fresh';
    }
    if (this.failedSignal()) {
      // Rows on screen from cache, and the network said no: that is exactly "stale".
      return 'stale';
    }
    const cachedAt = this.cachedAtSignal();
    return cachedAt !== null && Date.now() - cachedAt > DIRECTORY_TTL_MS ? 'stale' : 'fresh';
  });

  readonly fetchedAt = this.cachedAtSignal.asReadonly();

  /** The record currently open, if any. */
  private readonly recordSignal = signal<PatientRecordDto | null>(null);
  readonly record = this.recordSignal.asReadonly();

  private readonly recordLoadingSignal = signal(false);
  readonly recordLoading = this.recordLoadingSignal.asReadonly();

  private readonly recordFailedSignal = signal(false);
  readonly recordFailed = this.recordFailedSignal.asReadonly();

  /** Ids of cached records, oldest first, so the bound can be enforced. */
  private recentRecordIds: string[] = [];

  /**
   * Optimistic entries, kept only in memory.
   *
   * <p>Deliberately NOT written into the cached record: the cache is what the server said, and
   * mixing an unsent note into it would survive a restart as though it had been filed. The queue is
   * the durable half — this is only what to draw while it works.
   */
  private readonly pendingSignal = signal<readonly PendingEntry[]>([]);

  constructor() {
    // The queue owns WHEN a write is attempted; this store owns HOW. Registered here rather than
    // inside the queue so that class never grows a dependency on every feature in the app — and
    // without it a queued op sits pending forever, which is the quietest possible failure.
    this.queue.register('activity.append', write =>
      firstValueFrom(
        this.api.appendActivity(write.subjectId, {
          title: write.payload['title'] as string,
          description: write.payload['description'] as string,
          clientRef: write.clientRef,
        }),
      ),
    );
    this.queue.register('report.append', write =>
      firstValueFrom(
        this.api.appendReport(write.subjectId, {
          name: write.payload['name'] as string,
          reportType: write.payload['reportType'] as string,
          clientRef: write.clientRef,
        }),
      ),
    );
  }

  /**
   * Loads the directory from scratch, honouring the current filters.
   *
   * <p>Serves the cached page first when there is one, so the list is never blank while the request
   * is in flight — the same posture the rest of the app takes toward the cache.
   */
  async refresh(): Promise<void> {
    this.nextPage = 0;
    this.totalSignal.set(0);

    if (this.isUnfiltered()) {
      const cached = await this.cache.get<PatientListItemDto[]>(FIRST_PAGE_KEY);
      if (cached) {
        this.rowsSignal.set(cached.value);
        this.totalSignal.set(cached.value.length);
        this.cachedAtSignal.set(cached.fetchedAt);
      } else {
        this.rowsSignal.set([]);
      }
    } else {
      this.rowsSignal.set([]);
    }

    await this.loadMore(true);
  }

  private isUnfiltered(): boolean {
    const { query, sex, childrenOnly } = this.filtersSignal();
    return !query && !sex && !childrenOnly;
  }

  /** Applies a filter set and reloads from page zero. */
  async applyFilters(filters: Partial<PatientFilters>): Promise<void> {
    this.filtersSignal.update(current => ({ ...current, ...filters }));
    await this.refresh();
  }

  /**
   * Appends the next page.
   *
   * <p>Failure leaves what is already on screen alone. A directory that empties itself because page
   * three did not arrive is worse than one that simply stops growing.
   */
  async loadMore(replace = false): Promise<void> {
    if (this.loadingSignal()) {
      return;
    }
    this.loadingSignal.set(true);
    this.failedSignal.set(false);
    const { query, sex, childrenOnly } = this.filtersSignal();
    try {
      const response = await firstValueFrom(
        this.api.query({ page: this.nextPage, size: PAGE_SIZE, query, sex: sex ?? undefined, childrenOnly }),
      );
      const rows = response.body ?? [];
      const header = response.headers.get('X-Total-Count');
      const existing = replace ? [] : this.rowsSignal();
      // A missing header means "this is everything", not zero: zero would empty a list the server
      // had just filled.
      this.totalSignal.set(header === null ? existing.length + rows.length : Number(header));
      this.rowsSignal.set([...existing, ...rows]);

      // Page zero, unfiltered, is what a clinician sees with no signal. Written from the response
      // in hand rather than fetched a second time. Sealed: a list of the people a clinician is
      // treating should not sit readable in an app sandbox.
      if (this.nextPage === 0 && this.isUnfiltered()) {
        await this.cache.setSensitive(FIRST_PAGE_KEY, rows);
        this.cachedAtSignal.set(Date.now());
      }
      this.nextPage += 1;
    } catch {
      this.failedSignal.set(true);
    } finally {
      this.loadingSignal.set(false);
    }
  }

  /**
   * Opens one patient's record, from cache first and then from the network.
   *
   * <p>Cached individually and **sealed**: a record carries diagnoses, medications and clinical
   * notes, and the roster and document metadata that stay in the clear are nothing like it.
   *
   * <p>Shows the cached copy immediately so the screen is never blank, then replaces it. On failure
   * the cached copy stays — a record a clinician opened this morning is still worth reading in a
   * basement, marked as what it is.
   */
  async openRecord(patientId: string): Promise<void> {
    this.recordFailedSignal.set(false);
    const key = `patients.record.${patientId}`;

    const cached = await this.cache.get<PatientRecordDto>(key);
    this.recordSignal.set(cached?.value ?? null);
    this.recordLoadingSignal.set(cached === null);

    try {
      const fresh = await firstValueFrom(this.api.find(patientId));
      this.recordSignal.set(fresh);
      await this.cache.setSensitive(key, fresh);
      await this.remember(patientId);
    } catch {
      this.recordFailedSignal.set(cached === null);
    } finally {
      this.recordLoadingSignal.set(false);
    }
  }

  /**
   * Files an activity-log entry — through the queue, never straight to HTTP.
   *
   * <p>The entry appears on the record immediately, <b>marked</b> as unsent rather than merged in
   * indistinguishably. `web/`'s repository does the latter, which is fine at an 80 ms round trip on
   * a desk and is not fine on a phone that may hold the write for hours: a clinician scrolling a
   * record must never be shown something that looks filed and is not.
   *
   * <p>The optimistic entry carries the queued op's id so the chip can follow its state, and it is
   * replaced by the server's own copy on the next successful read.
   */
  async fileActivity(patientId: string, entry: { title: string; description: string }): Promise<void> {
    const write = await this.queue.submit('activity.append', patientId, { patientId, ...entry });
    this.pendingSignal.update(existing => [...existing, { write, patientId, kind: 'activity', label: entry.title }]);
  }

  /** Files a clinical report. Metadata only — see `PatientApiService.appendReport`. */
  async fileReport(patientId: string, report: { name: string; reportType: string }): Promise<void> {
    const write = await this.queue.submit('report.append', patientId, { patientId, ...report });
    this.pendingSignal.update(existing => [...existing, { write, patientId, kind: 'report', label: report.name }]);
  }

  /** Unsent entries for the record currently open, so they render above the filed ones. */
  readonly pendingForOpenRecord = computed(() => {
    const open = this.recordSignal()?.id;
    if (!open) {
      return [];
    }
    const live = new Set(this.queue.writes().map(write => write.id));
    return (
      this.pendingSignal()
        .filter(entry => entry.patientId === open)
        // An op that has left the queue has landed; the next read shows the server's own copy.
        .filter(entry => live.has(entry.write.id))
        .map(entry => ({
          ...entry,
          state: this.queue.writes().find(write => write.id === entry.write.id)?.state ?? 'pending',
        }))
    );
  });

  closeRecord(): void {
    this.recordSignal.set(null);
    this.recordFailedSignal.set(false);
  }

  /** Keeps the cached-record set bounded, dropping the least recently opened. */
  private async remember(patientId: string): Promise<void> {
    this.recentRecordIds = [...this.recentRecordIds.filter(id => id !== patientId), patientId];
    while (this.recentRecordIds.length > RECORD_CACHE_LIMIT) {
      const evicted = this.recentRecordIds.shift();
      if (evicted) {
        await this.cache.remove(`patients.record.${evicted}`);
      }
    }
  }
}
