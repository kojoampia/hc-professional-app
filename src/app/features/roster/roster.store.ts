import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { AbsenceApiService, AbsenceDto, AbsenceType } from '../../core/api/absence-api.service';
import { DaySummaryDto, DutyRosterApiService, DutyRosterAssignmentDto, isoDate } from '../../core/api/duty-roster-api.service';
import { CacheStore } from '../../core/offline/cache-store.service';
import { CachedResource, cachedResource } from '../../core/offline/cached-resource';

/** A roster changes when an administrator edits it, which is rarely and never on the hour. */
const SUMMARY_TTL_MS = 12 * 60 * 60 * 1000;

/** Own leave changes only when this clinician or an administrator acts. */
const ABSENCE_TTL_MS = 12 * 60 * 60 * 1000;

/** How a day looks once the summary and the absence list are read together. */
export interface RosterDay {
  date: string;
  shifts: DaySummaryDto['shifts'];
  visits: number;
  absence: { type: string; status: string } | null;
}

/**
 * The roster calendar: which days are worked, which are off, and what a chosen day holds.
 *
 * <h3>Why the year summary is cached and the day view is not</h3>
 * `GET /duty-roster/summary` is a read. `GET /duty-roster/day/{date}` **is not** — the server
 * refreshes visit snapshots as it serves it, deliberately, and it is the one roster endpoint
 * excluded from the server's ETag filter for that reason. Caching it would mean a clinician opening
 * a day and skipping the write that keeps the customer details current. So the day is fetched on
 * every tap, and it is the only thing on this screen that needs a network.
 *
 * <h3>A day can be both rostered and on leave</h3>
 * Neither field suppresses the other. Leave asked for over a shift that has not been reassigned is
 * exactly the day worth seeing — it is what the server's 409 refuses to approve — so the calendar
 * marks both and the day view shows both.
 */
@Injectable({ providedIn: 'root' })
export class RosterStore {
  private readonly rosterApi = inject(DutyRosterApiService);
  private readonly absenceApi = inject(AbsenceApiService);
  private readonly cache = inject(CacheStore);

  /** The year the calendar is showing. Drives which summary is loaded. */
  private readonly yearSignal = signal(new Date().getFullYear());
  readonly year = this.yearSignal.asReadonly();

  readonly summary: CachedResource<DaySummaryDto[]> = cachedResource(this.cache, {
    key: 'roster.summary',
    ttlMs: SUMMARY_TTL_MS,
    fetch: () => this.rosterApi.summary(this.yearSignal()),
  });

  readonly absences: CachedResource<AbsenceDto[]> = cachedResource(this.cache, {
    key: 'roster.absences',
    ttlMs: ABSENCE_TTL_MS,
    fetch: () => this.absenceApi.mine(),
  });

  /** The day the clinician has open, and what it holds. Never cached — see the class note. */
  private readonly selectedDateSignal = signal<string | null>(null);
  readonly selectedDate = this.selectedDateSignal.asReadonly();

  private readonly dayState = signal<readonly DutyRosterAssignmentDto[]>([]);
  readonly day = computed(() => this.dayState());

  private readonly dayLoadingSignal = signal(false);
  readonly dayLoading = this.dayLoadingSignal.asReadonly();

  private readonly dayFailedSignal = signal(false);
  readonly dayFailed = this.dayFailedSignal.asReadonly();

  /** Dates with at least one rostered shift, for the calendar's marks. */
  readonly workedDates = computed(() => (this.summary.value() ?? []).filter(d => d.shifts.length > 0).map(d => d.date));

  /** Dates covered by leave, requested or approved. A day can appear in both lists. */
  readonly absentDates = computed(() => {
    const dates = new Set<string>();
    for (const absence of this.absences.value() ?? []) {
      for (const date of datesBetween(absence.fromDate, absence.toDate)) {
        dates.add(date);
      }
    }
    return [...dates];
  });

  /** Own leave, soonest first, for the list under the calendar. */
  readonly upcomingAbsences = computed(() => {
    const today = isoDate(new Date());
    return [...(this.absences.value() ?? [])].filter(a => a.toDate >= today).sort((a, b) => a.fromDate.localeCompare(b.fromDate));
  });

  readonly oldestFetchedAt = computed(() => {
    const stamps = [this.summary.fetchedAt(), this.absences.fetchedAt()].filter((s): s is number => s !== null);
    return stamps.length ? Math.min(...stamps) : null;
  });

  readonly isStale = computed(() => this.summary.status() === 'stale' || this.absences.status() === 'stale');

  async refresh(): Promise<void> {
    await Promise.all([this.summary.refresh(), this.absences.refresh()]);
  }

  /** Moves the calendar to another year and reloads its marks. */
  async showYear(year: number): Promise<void> {
    this.yearSignal.set(year);
    await this.summary.refresh();
  }

  /**
   * Opens one day.
   *
   * <p>Always a network read, deliberately — see the class note. It fails visibly rather than
   * falling back to a cached copy, because a stale round with stale customer details is worse at a
   * doorstep than an honest "could not load".
   */
  async openDay(date: string): Promise<void> {
    this.selectedDateSignal.set(date);
    this.dayState.set([]);
    this.dayFailedSignal.set(false);
    this.dayLoadingSignal.set(true);
    try {
      this.dayState.set(await firstValueFrom(this.rosterApi.day(date)));
    } catch {
      this.dayFailedSignal.set(true);
    } finally {
      this.dayLoadingSignal.set(false);
    }
  }

  closeDay(): void {
    this.selectedDateSignal.set(null);
    this.dayState.set([]);
    this.dayFailedSignal.set(false);
  }

  /**
   * Requests leave, then re-reads.
   *
   * <p>No optimistic insert: an absence that appears on the calendar and then vanishes because the
   * server refused it is worse than one that takes a moment to appear. There is no offline write
   * queue yet, so this fails visibly with no signal — the same rule every other mutation in this app
   * follows.
   */
  async requestAbsence(request: { fromDate: string; toDate: string; type: AbsenceType }): Promise<void> {
    await firstValueFrom(this.absenceApi.request(request));
    await this.absences.refresh();
  }

  async withdrawAbsence(id: string): Promise<void> {
    await firstValueFrom(this.absenceApi.withdraw(id));
    await this.absences.refresh();
  }
}

/**
 * Every date from `from` to `to`, inclusive.
 *
 * <p>Stepped at midday rather than midnight so a DST transition cannot land twice on the same date
 * or skip one — the same reason `previousDay` in the roster service does it.
 */
export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (cursor <= end) {
    dates.push(isoDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}
