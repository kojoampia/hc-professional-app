import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApplicationConfigService } from '../config/application-config.service';

/**
 * The shift types the server actually has, as a runtime array.
 *
 * <p><b>MORNING and AFTERNOON were retired in DR1 (2026-08-20)</b> and existing rows migrated by
 * nearest window — MORNING → DAY, AFTERNOON → EVENING, by `ShiftTypeMigration`. This union carried
 * both of them and was missing EVENING entirely, which is what every migrated AFTERNOON became.
 * Do not reintroduce them: the five-value set they belonged to overlapped, since the old DAY
 * (08–17) straddled both.
 *
 * <p><b>`OFF` was added on 2026-09-04</b>, when the estate settled on one shift vocabulary across
 * hc-admin and hc-professional rather than two four-value enums differing by one value at each end.
 * It is a rostered rest day: planned, not worked, no window, and never carrying visits.
 *
 * <p><b>An array rather than a bare union, and that is new here.</b> This was
 * `'DAY' | 'EVENING' | 'NIGHT' | 'FLEXIBLE'`, which no test can enumerate — so nothing could ask
 * whether the catalogues named every value, and this app had no shift names at all to ask about:
 * `roster.page` and `today.page` rendered `{{ round.shift | titlecase }}`, which happens to produce
 * an acceptable "Off" in English and nothing sensible in the other three. `web/`'s copy has been a
 * `const` array with the union derived from it for exactly this reason. **Mobile CI clones one
 * repo**, so nothing in `web/` or `api/` can see this file; the array, the catalogue keys and
 * `shift-names.spec.ts` beside it are what buy this copy the same gate instead of leaving it the
 * hand-carried part that goes stale silently. Its own history is the argument — it held the pre-DR1
 * windows for an unknown period with nothing failing.
 */
export const DUTY_ROSTER_SHIFTS = ['DAY', 'EVENING', 'NIGHT', 'OFF', 'FLEXIBLE'] as const;

/** The union, derived from the list above rather than written twice. */
export type DutyRosterShift = (typeof DUTY_ROSTER_SHIFTS)[number];

export interface DutyRosterAssignmentDto {
  id?: string;
  date: string;
  duty: string;
  professionalId: string;
  shift: DutyRosterShift;
  name: string;
  description?: string | null;
  /** Present on the day read only. Treat as optional at every call site. */
  visits?: VisitDto[] | null;
}

/** One visit inside a rostered round. Present on the day read; absent from the range read. */
export interface VisitDto {
  id?: string;
  customerId: string;
  /** `HH:mm[:ss]` local to the shift's date. NIGHT wraps: 01:00 belongs to the previous date's shift. */
  startTime: string;
  endTime: string;
  customerName?: string | null;
  customerAddress?: string | null;
  customerPhone?: string | null;
}

/**
 * One day in the year summary.
 *
 * <p><b>A day can carry both a round and an absence, and neither suppresses the other.</b> Leave
 * asked for over a shift that has not been reassigned is exactly the day worth seeing, and it is
 * what the server's 409 refuses to approve. Rendering only one of the two hides the conflict.
 */
export interface DaySummaryDto {
  date: string;
  shifts: DutyRosterShift[];
  visits: number;
  absence: { type: string; status: string } | null;
}

export interface ShiftLabel {
  kind: 'active' | 'next' | 'flexible' | 'nextFlexible';
  /** End time for an active shift, start time for the next one. */
  time?: string;
  date?: string;
}

/**
 * Local shift windows (hour of day, 24h): NIGHT wraps past midnight. FLEXIBLE and
 * OFF deliberately have no window — FLEXIBLE stands for individually agreed 2–4
 * hour time blocks on the assignment date, OFF is a rest day that is not worked at
 * all, and both are labelled separately.
 *
 * Copied from `web/src/main/webapp/app/health-connect/health-connect.models.ts`, where DR1 moved
 * the table so the union and its hours sit in one place. These windows are a cross-repo invariant
 * documented on `api/domain/enumeration/ShiftType` — change them here and they must change there.
 *
 * <p><b>Corrected 2026-08-22.</b> This table held the PRE-DR1 windows: DAY 08–17, NIGHT 22–06, plus
 * MORNING and AFTERNOON, and no EVENING at all. Three things were wrong on a clinician's phone as a
 * result. An EVENING shift — what every migrated AFTERNOON became — found no window, so the card
 * could not say when it ended and `selectShift` never reported "on duty" during one. A DAY shift
 * read 08:00–17:00 when it is 07:00–15:00, so someone on shift at 07:30 was told they were not. And
 * NIGHT was an hour out at both ends, which is the boundary the whole wrapping rule exists for.
 */
const SHIFT_WINDOWS: Partial<Record<DutyRosterShift, { start: number; end: number }>> = {
  DAY: { start: 7, end: 15 },
  EVENING: { start: 15, end: 23 },
  NIGHT: { start: 23, end: 7 },
};

/** Sorting anchor for the windowless values, which have no meaningful start. */
const DEFAULT_START_HOUR = 7;

const startHour = (shift: DutyRosterShift): number => SHIFT_WINDOWS[shift]?.start ?? DEFAULT_START_HOUR;

const pad = (n: number): string => String(n).padStart(2, '0');

export const isoDate = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const previousDay = (date: string): string => {
  // Midday avoids the DST edge where midnight-minus-one-day can land on the same date.
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return isoDate(d);
};

/** Human window text for a card, e.g. `06:00–14:00`. FLEXIBLE has none. */
export function shiftWindowText(shift: DutyRosterShift): string | null {
  const window = SHIFT_WINDOWS[shift];
  return window ? `${pad(window.start)}:00–${pad(window.end)}:00` : null;
}

/** The one assignment the Today card is about, and what it is doing. */
export interface SelectedShift {
  assignment: DutyRosterAssignmentDto;
  kind: ShiftLabel['kind'];
}

/**
 * Picks the assignment the clinician cares about right now: the one they are on, or
 * the next one coming.
 *
 * Split out from {@link computeShiftLabel} so the headline and the card body cannot
 * disagree. They previously did: the label came from here, while the card body took
 * `upcoming[0]` — which still includes a shift that finished earlier today. At 15:54
 * that produced a card reading "Next shift tomorrow 22:00" above the details of this
 * morning's 06:00–14:00 shift. One selection, two presentations.
 */
export function selectShift(assignments: readonly DutyRosterAssignmentDto[], now: Date): SelectedShift | null {
  const today = isoDate(now);
  const hour = now.getHours();

  for (const assignment of assignments) {
    const window = SHIFT_WINDOWS[assignment.shift];
    if (!window) {
      continue;
    }
    const active =
      assignment.shift === 'NIGHT'
        ? (assignment.date === today && hour >= window.start) || (assignment.date === previousDay(today) && hour < window.end)
        : assignment.date === today && hour >= window.start && hour < window.end;
    if (active) {
      return { assignment, kind: 'active' };
    }
  }

  // A FLEXIBLE assignment covers its whole date in 2-4h blocks.
  const flexibleToday = assignments.find(a => a.shift === 'FLEXIBLE' && a.date === today);
  if (flexibleToday) {
    return { assignment: flexibleToday, kind: 'flexible' };
  }

  // OFF is dropped before the search, and web's `computeShiftLabel` drops it in the same place — the
  // two must agree or one clinician sees different answers on their phone and on the web app. The
  // loop above already skips it for free, having no window; this search does not, because
  // `startHour` answers the 07:00 default for any windowless value. That default was written when
  // FLEXIBLE was the only one and means "sorts with the morning"; applied to OFF it puts "Next shift
  // 07:00" on the Today card for a rostered rest day.
  const upcoming = assignments
    .filter(a => a.shift !== 'OFF')
    .filter(a => a.date > today || (a.date === today && hour < startHour(a.shift)))
    .sort((a, b) => (a.date === b.date ? startHour(a.shift) - startHour(b.shift) : a.date < b.date ? -1 : 1))[0];

  return upcoming ? { assignment: upcoming, kind: upcoming.shift === 'FLEXIBLE' ? 'nextFlexible' : 'next' } : null;
}

/**
 * Active shift → "on duty until"; otherwise the next upcoming one.
 *
 * Ported from web's `computeShiftLabel` (web commit 48a12fc), including the NIGHT
 * past-midnight branch and the FLEXIBLE whole-day case. Its 108-line spec came
 * across with it — this is the logic driving the sidebar card on the web app, and
 * the two must agree or the same clinician sees different answers on two screens.
 * Only the return shape changed: web emits i18n keys, this emits a discriminated
 * union the template formats.
 */
export function computeShiftLabel(assignments: readonly DutyRosterAssignmentDto[], now: Date): ShiftLabel | null {
  const selected = selectShift(assignments, now);
  if (!selected) {
    return null;
  }
  const { assignment, kind } = selected;
  switch (kind) {
    case 'active':
      return { kind: 'active', time: `${pad(SHIFT_WINDOWS[assignment.shift]?.end ?? 0)}:00` };
    case 'flexible':
      return { kind: 'flexible', date: assignment.date };
    case 'nextFlexible':
      return { kind: 'nextFlexible', date: assignment.date };
    default:
      return { kind: 'next', date: assignment.date, time: `${pad(startHour(assignment.shift))}:00` };
  }
}

/**
 * The clinician's own assignments.
 *
 * Read-only by design: `DutyRosterResource` has no self-subscription endpoint —
 * rosters are assigned by administrators. Web's `listAll`/`assign`/`unassign` are
 * admin-only and deliberately not ported.
 */
@Injectable({ providedIn: 'root' })
export class DutyRosterApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApplicationConfigService);

  private get resourceUrl(): string {
    // SINGULAR, and the bare GET means "mine".
    //
    // This read `api/duty-rosters` with a `/my` suffix and 404'd on every request — the Today tab's
    // roster strip and Me → share my roster have both been empty in production. The comment that
    // stood here argued the plural path was correct, which is why the 404 survived review, and
    // `me.page.spec.ts` hardcoded the same wrong URL so the suite was green because of the bug.
    //
    // The rename went half-way: WP6 moved the resource off the onboarding prefix, and DR1 then made
    // it singular AND inverted the meaning of the bare GET, so `/my` no longer exists. Confirmed
    // against the deployed service — `api/duty-roster` 200s, `api/duty-rosters/my` 404s — and
    // `web/`'s duty-roster-assignments.service.ts uses the same singular resource.
    //
    // `/all` is the admin list and is deliberately not reachable from this client.
    return this.config.getEndpointFor('api/duty-roster', 'professionalservice');
  }

  /** The caller's own assignments. The bare GET is already scoped to them server-side. */
  myAssignments(): Observable<DutyRosterAssignmentDto[]> {
    return this.http.get<DutyRosterAssignmentDto[]>(this.resourceUrl);
  }

  /**
   * The caller's assignments between two dates, inclusive.
   *
   * <p>Ported from `web/`'s `range()`. Used by the roster calendar so a month view costs one request
   * rather than one per day.
   */
  range(from: string, to: string): Observable<DutyRosterAssignmentDto[]> {
    return this.http.get<DutyRosterAssignmentDto[]>(this.resourceUrl, { params: { from, to } });
  }

  /**
   * Per-day counts for a whole year, for the calendar's density marks.
   *
   * <p>Cheap enough to cache; `day()` deliberately is not — see below.
   */
  summary(year: number): Observable<DaySummaryDto[]> {
    return this.http.get<DaySummaryDto[]>(`${this.resourceUrl}/summary`, { params: { year } });
  }

  /**
   * One day in full: rounds, visits, and the customer details a clinician needs at the door.
   *
   * <p><b>Never cache this and never prefetch it.</b> The server refreshes visit snapshots as it
   * reads — a write on the read path, deliberate and documented on `DutyRosterResource`, and the
   * reason `/day/{date}` is excluded from the ETag filter. Skipping the call to serve a cached copy
   * skips the write it exists to perform. Fetch it when the clinician taps a day, and only then.
   */
  day(date: string): Observable<DutyRosterAssignmentDto[]> {
    return this.http.get<DutyRosterAssignmentDto[]>(`${this.resourceUrl}/day/${encodeURIComponent(date)}`);
  }
}
