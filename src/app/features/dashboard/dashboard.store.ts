import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { CaseApiService } from '../../core/api/case-api.service';
import { DashboardApiService, DashboardSummaryDto } from '../../core/api/dashboard-api.service';
import { CacheStore } from '../../core/offline/cache-store.service';
import { ResourceStatus } from '../../core/offline/cached-resource';

/** Figures move slowly. A dashboard an hour old is still worth reading; a blank one is not. */
const TTL_MS = 60 * 60 * 1000;

const SUMMARY_KEY = 'dashboard.summary';

/** The statuses the tiles count, in the order they are shown. */
export const CASE_STATUSES = ['open', 'urgent', 'closed'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/**
 * The numbers on the dashboard, and nothing else.
 *
 * <h3>Every tile is either a number the server gave or an em dash</h3>
 * Never a zero standing in for a failure. `DashboardResource` takes the same position by omitting
 * case fields entirely rather than sending zeros for them, and its javadoc says why: *a tile reading
 * "0 urgent" is a clinical claim; an absent field is a missing panel.* The two halves here fail
 * independently, so patients can render while cases show dashes, which is the honest picture when
 * only one source answered.
 *
 * <h3>Case counts come from the queue, not from a dashboard endpoint</h3>
 * There is no case endpoint on `/api/dashboard` and there should not be — cases belong to
 * patientservice, and having professionalservice fetch every one to aggregate would make the
 * dashboard unavailable whenever the sibling is slow. Instead each status is asked for as a page of
 * <b>size one</b> and only `X-Total-Count` is read: three tiny requests for three exact totals,
 * rather than downloading a caseload to count it.
 *
 * <p>That is also why these are exact rather than the "counted over the rows loaded" figures the
 * case queue screen shows. The queue is honest about counting a page; a dashboard would not be.
 *
 * <h3>Only the patient summary is cached</h3>
 * Four small integers with no clinical content, so it is stored in the clear and the shell can show
 * something on a cold start with no signal. Case counts are not cached: they move as a clinician
 * works, and a stale "2 urgent" is worse than a dash.
 */
@Injectable({ providedIn: 'root' })
export class DashboardStore {
  private readonly api = inject(DashboardApiService);
  private readonly cases = inject(CaseApiService);
  private readonly cache = inject(CacheStore);

  private readonly summarySignal = signal<DashboardSummaryDto | null>(null);
  private readonly summaryFailedSignal = signal(false);
  private readonly fetchedAtSignal = signal<number | null>(null);
  readonly fetchedAt = this.fetchedAtSignal.asReadonly();

  private readonly caseCountsSignal = signal<Record<CaseStatus, number> | null>(null);

  readonly patients = computed(() => this.summarySignal()?.patients ?? null);
  readonly female = computed(() => this.summarySignal()?.female ?? null);
  readonly male = computed(() => this.summarySignal()?.male ?? null);
  readonly kids = computed(() => this.summarySignal()?.kids ?? null);

  readonly openCases = computed(() => this.caseCountsSignal()?.open ?? null);
  readonly urgentCases = computed(() => this.caseCountsSignal()?.urgent ?? null);
  readonly closedCases = computed(() => this.caseCountsSignal()?.closed ?? null);

  /** True when the case half failed while the patient half did not — the screen says so. */
  readonly casesUnavailable = computed(() => this.caseCountsSignal() === null && this.summarySignal() !== null);

  readonly status = computed<ResourceStatus>(() => {
    if (this.summarySignal() === null) {
      return this.summaryFailedSignal() ? 'error' : 'fresh';
    }
    if (this.summaryFailedSignal()) {
      return 'stale';
    }
    const fetchedAt = this.fetchedAtSignal();
    return fetchedAt !== null && Date.now() - fetchedAt > TTL_MS ? 'stale' : 'fresh';
  });

  async refresh(): Promise<void> {
    // Independently, and neither awaited before the other starts: a slow patientservice must not
    // hold up figures this service can answer by itself.
    await Promise.all([this.loadSummary(), this.loadCaseCounts()]);
  }

  private async loadSummary(): Promise<void> {
    const cached = await this.cache.get<DashboardSummaryDto>(SUMMARY_KEY);
    if (cached) {
      this.summarySignal.set(cached.value);
      this.fetchedAtSignal.set(cached.fetchedAt);
    }

    this.summaryFailedSignal.set(false);
    try {
      const summary = await firstValueFrom(this.api.summary());
      this.summarySignal.set(summary);
      // In the clear: four integers with no clinical content, so the shell can render them before
      // the keystore is unlocked. Everything sensitive in this app uses setSensitive instead.
      await this.cache.set(SUMMARY_KEY, summary);
      this.fetchedAtSignal.set(Date.now());
    } catch {
      this.summaryFailedSignal.set(true);
    }
  }

  /**
   * One page of size one per status, read only for `X-Total-Count`.
   *
   * <p>A missing header would make the count unknowable rather than zero, so it is treated as a
   * failure of the whole set. Reporting two statuses and a dash for the third would invite reading
   * the two as a complete picture.
   */
  private async loadCaseCounts(): Promise<void> {
    try {
      const totals = await Promise.all(
        CASE_STATUSES.map(async status => {
          const response = await firstValueFrom(this.cases.queue(0, 1, status));
          const header = response.headers.get('X-Total-Count');
          if (header === null) {
            throw new Error(`no X-Total-Count for ${status}`);
          }
          return [status, Number(header)] as const;
        }),
      );
      this.caseCountsSignal.set(Object.fromEntries(totals) as Record<CaseStatus, number>);
    } catch {
      this.caseCountsSignal.set(null);
    }
  }
}
