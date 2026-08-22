import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { CaseApiService, CaseDetailDto, CaseSummaryDto, CaseUpdateDto } from '../../core/api/case-api.service';
import { CacheStore } from '../../core/offline/cache-store.service';
import { ResourceStatus } from '../../core/offline/cached-resource';
import { QueuedWrite } from '../../core/offline/queued-write.model';
import { WriteQueue } from '../../core/offline/write-queue.service';

export const PAGE_SIZE = 20;

/** Cases move when a clinician works them, so this is shorter than the roster's twelve hours. */
const QUEUE_TTL_MS = 60 * 60 * 1000;

const FIRST_PAGE_KEY = 'cases.firstPage';

/**
 * The clinician's case queue, and the case they have open.
 *
 * <p>Same shape as the patient directory, and for the same reasons: page zero cached and sealed,
 * later pages online-only, the status filter sent to the server rather than applied in the browser.
 * A case carries a brief and a diagnosis, so nothing here is written to disk in the clear.
 *
 * <p>Edits go through the write queue as `case.patch`, which is where that op kind's collapse rule
 * and its 409 path finally get exercised on something real: two edits to one case collapse to the
 * latest, and a colleague editing the same case stops the op rather than overwriting them.
 */
@Injectable({ providedIn: 'root' })
export class CasesStore {
  private readonly api = inject(CaseApiService);
  private readonly cache = inject(CacheStore);
  private readonly queue = inject(WriteQueue);

  private readonly statusFilterSignal = signal<string | null>(null);
  readonly statusFilter = this.statusFilterSignal.asReadonly();

  private readonly rowsSignal = signal<readonly CaseSummaryDto[]>([]);
  readonly rows = computed(() => this.rowsSignal());

  private readonly totalSignal = signal(0);
  readonly total = this.totalSignal.asReadonly();

  private readonly failedSignal = signal(false);
  private readonly loadingSignal = signal(false);
  private readonly cachedAtSignal = signal<number | null>(null);
  readonly fetchedAt = this.cachedAtSignal.asReadonly();

  private nextPage = 0;

  readonly hasMore = computed(() => this.rowsSignal().length < this.totalSignal());

  readonly status = computed<ResourceStatus>(() => {
    if (this.rowsSignal().length === 0) {
      return this.failedSignal() ? 'error' : 'fresh';
    }
    if (this.failedSignal()) {
      return 'stale';
    }
    const cachedAt = this.cachedAtSignal();
    return cachedAt !== null && Date.now() - cachedAt > QUEUE_TTL_MS ? 'stale' : 'fresh';
  });

  /**
   * Counts for the tiles.
   *
   * <p>Null rather than zero when nothing loaded. "0 urgent" is a statement about a caseload, and a
   * tile making it because a request failed is worse than one admitting it does not know — the same
   * position `DashboardResource` takes by omitting fields it cannot answer.
   *
   * <p>Counted over the rows <em>loaded</em>, which is honest for a first page and not a claim about
   * the whole queue. The server's total is shown separately.
   */
  readonly openCount = computed(() => this.countOf('open'));
  readonly urgentCount = computed(() => this.countOf('urgent'));
  readonly closedCount = computed(() => this.countOf('closed'));

  private countOf(status: string): number | null {
    if (this.rowsSignal().length === 0 && this.status() === 'error') {
      return null;
    }
    return this.rowsSignal().filter(row => (row.status ?? '').toLowerCase() === status).length;
  }

  private readonly openCaseSignal = signal<CaseDetailDto | null>(null);
  readonly openCase = this.openCaseSignal.asReadonly();

  private readonly openingSignal = signal(false);
  readonly opening = this.openingSignal.asReadonly();

  private readonly openFailedSignal = signal(false);
  readonly openFailed = this.openFailedSignal.asReadonly();

  constructor() {
    this.queue.register('case.patch', (write: QueuedWrite) =>
      firstValueFrom(this.api.update(write.payload['patientId'] as string, write.subjectId, write.payload['changes'] as CaseUpdateDto)),
    );
  }

  /** The unsent edit to the case currently open, if any, so the screen can mark it. */
  readonly pendingEditFor = computed(() => {
    const open = this.openCaseSignal()?.id;
    return open ? this.queue.writes().find(write => write.kind === 'case.patch' && write.subjectId === open) ?? null : null;
  });

  async refresh(): Promise<void> {
    this.nextPage = 0;
    this.totalSignal.set(0);

    if (this.statusFilterSignal() === null) {
      const cached = await this.cache.get<CaseSummaryDto[]>(FIRST_PAGE_KEY);
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

  async filterByStatus(status: string | null): Promise<void> {
    this.statusFilterSignal.set(status);
    await this.refresh();
  }

  async loadMore(replace = false): Promise<void> {
    if (this.loadingSignal()) {
      return;
    }
    this.loadingSignal.set(true);
    this.failedSignal.set(false);
    try {
      const response = await firstValueFrom(this.api.queue(this.nextPage, PAGE_SIZE, this.statusFilterSignal() ?? undefined));
      const rows = response.body ?? [];
      const header = response.headers.get('X-Total-Count');
      const existing = replace ? [] : this.rowsSignal();
      // A missing header means "this is everything", not zero.
      this.totalSignal.set(header === null ? existing.length + rows.length : Number(header));
      this.rowsSignal.set([...existing, ...rows]);

      if (this.nextPage === 0 && this.statusFilterSignal() === null) {
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
   * Opens one case.
   *
   * <p>The row is not enough — it carries no symptoms and no diagnosis, deliberately — so this
   * fetches the full case. <b>Nothing is cached</b>: a case body is the most sensitive thing this
   * app reads, it is being actively edited by several people, and a stale diagnosis rendered as
   * current is a worse failure than a screen that will not open without signal.
   */
  async openCaseById(row: CaseSummaryDto): Promise<void> {
    this.openingSignal.set(true);
    this.openFailedSignal.set(false);
    try {
      this.openCaseSignal.set(await firstValueFrom(this.api.detail(row.patientId, row.id)));
    } catch {
      this.openFailedSignal.set(true);
    } finally {
      this.openingSignal.set(false);
    }
  }

  close(): void {
    this.openCaseSignal.set(null);
    this.openFailedSignal.set(false);
  }

  /**
   * Queues an edit.
   *
   * <p>The optimistic value is applied on screen so the clinician sees their own words, marked
   * unsent. It is <b>not</b> written to the cache: the cache is what the server said, and a restart
   * must not resurrect an edit that never landed.
   */
  async edit(changes: CaseUpdateDto): Promise<void> {
    const open = this.openCaseSignal();
    if (!open) {
      return;
    }
    await this.queue.submit('case.patch', open.id, { patientId: open.patientId, changes });
    const optimistic: CaseDetailDto = {
      ...open,
      brief: changes.brief ?? open.brief,
      status: changes.status ?? open.status,
      symptoms: changes.symptoms ?? open.symptoms,
      diagnosis: changes.diagnosis ?? open.diagnosis,
    };
    this.openCaseSignal.set(optimistic);
    this.rowsSignal.update(rows =>
      rows.map(row => (row.id === open.id ? { ...row, brief: optimistic.brief, status: optimistic.status } : row)),
    );
  }
}
