import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApplicationConfigService } from '../config/application-config.service';

export type DutyRosterShift = 'MORNING' | 'AFTERNOON' | 'NIGHT' | 'DAY' | 'FLEXIBLE';

export interface DutyRosterAssignmentDto {
  id?: string;
  date: string;
  duty: string;
  professionalId: string;
  shift: DutyRosterShift;
  name: string;
  description?: string | null;
}

export interface ShiftLabel {
  kind: 'active' | 'next' | 'flexible' | 'nextFlexible';
  /** End time for an active shift, start time for the next one. */
  time?: string;
  date?: string;
}

/**
 * Local shift windows (hour of day, 24h): NIGHT wraps past midnight. FLEXIBLE
 * deliberately has no window — it stands for individually agreed 2–4 hour time
 * blocks on the assignment date and is labelled separately.
 *
 * Copied from `web/src/main/webapp/app/health-connect/api/duty-roster-assignments.service.ts`
 * (web commit 48a12fc). These windows are a cross-repo invariant, documented on
 * `api/domain/enumeration/ShiftType` — change them here and they must change there.
 */
const SHIFT_WINDOWS: Partial<Record<DutyRosterShift, { start: number; end: number }>> = {
  MORNING: { start: 6, end: 14 },
  AFTERNOON: { start: 14, end: 22 },
  NIGHT: { start: 22, end: 6 },
  DAY: { start: 8, end: 17 },
};

/** Sorting anchor for windowless (FLEXIBLE) shifts. */
const DEFAULT_START_HOUR = 8;

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

  const upcoming = assignments
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
    // /api/duty-rosters, not /api/onboarding/duty-rosters: the roster is owned by
    // professionalservice and left the onboarding prefix WP6 had put it under (api 0b2cfbb). The
    // old path is gone rather than aliased, so this would 404 — the Today tab's roster strip is
    // what breaks. Safe to change outright because the app has never shipped: no tags, MOB12/MOB13
    // unstarted, so there is no installed build still calling the old surface.
    return this.config.getEndpointFor('api/duty-rosters', 'professionalservice');
  }

  myAssignments(): Observable<DutyRosterAssignmentDto[]> {
    return this.http.get<DutyRosterAssignmentDto[]>(`${this.resourceUrl}/my`);
  }
}
