import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';

import {
  DutyRosterApiService,
  DutyRosterAssignmentDto,
  computeShiftLabel,
  isoDate,
  selectShift,
  shiftWindowText,
} from './duty-roster-api.service';

/**
 * Shift-window logic, ported with `computeShiftLabel` from
 * `web/.../duty-roster-assignments.service.ts` (web commit 48a12fc).
 *
 * These windows are a cross-repo invariant documented on `api/domain/enumeration/ShiftType`:
 * DAY 07–15, EVENING 15–23, NIGHT 23–07 (wraps), FLEXIBLE none.
 *
 * They were DAY 08–17, NIGHT 22–06, MORNING 06–14 and AFTERNOON 14–22 here until 2026-08-22 — the
 * set DR1 retired on 2026-08-20 — and this spec asserted them, so it stayed green while the phone
 * told clinicians the wrong hours and never recognised an EVENING shift at all. A fixture copied
 * from the code it tests proves only that the two agree.
 * The same clinician must not see a different answer on the phone than on the web
 * dashboard, so this suite mirrors web's edge cases rather than inventing new ones.
 */
describe('computeShiftLabel', () => {
  const at = (iso: string): Date => new Date(iso);

  /** Not on shift: either nothing to report at all, or something that is not active. */
  const expectNotActive = (label: ReturnType<typeof computeShiftLabel>): void => {
    expect(label === null || label.kind !== 'active').toBe(true);
  };

  const assignment = (over: Partial<DutyRosterAssignmentDto>): DutyRosterAssignmentDto => ({
    id: over.id ?? 'a1',
    date: over.date ?? '2026-08-05',
    duty: over.duty ?? 'NURSE',
    professionalId: 'p1',
    shift: over.shift ?? 'DAY',
    name: over.name ?? 'Ward B',
    description: null,
  });

  it('returns nothing when there is nothing assigned', () => {
    expect(computeShiftLabel([], at('2026-08-05T09:00:00'))).toBeNull();
  });

  describe('an active shift', () => {
    it('reports the end of a DAY shift during it', () => {
      const label = computeShiftLabel([assignment({ shift: 'DAY' })], at('2026-08-05T09:00:00'));
      expect(label).toEqual({ kind: 'active', time: '15:00' });
    });

    it('is active at the very start of the window', () => {
      expect(computeShiftLabel([assignment({ shift: 'DAY' })], at('2026-08-05T07:00:00'))).toMatchObject({ kind: 'active' });
    });

    it('is NOT active at the very end — the window is half-open', () => {
      // 15:00 belongs to EVENING, not DAY. An inclusive end would report two active
      // shifts at the changeover.
      expectNotActive(computeShiftLabel([assignment({ shift: 'DAY' })], at('2026-08-05T15:00:00')));
    });

    it('handles EVENING, the shift every migrated AFTERNOON became', () => {
      // It had no window at all here until 2026-08-22, so this never reported active:
      // a clinician on an evening shift was told they were off.
      expect(computeShiftLabel([assignment({ shift: 'EVENING' })], at('2026-08-05T18:00:00'))).toEqual({
        kind: 'active',
        time: '23:00',
      });
    });

    it('is active at 07:30, which the old 08:00 DAY start called off duty', () => {
      expect(computeShiftLabel([assignment({ shift: 'DAY' })], at('2026-08-05T07:30:00'))).toEqual({ kind: 'active', time: '15:00' });
    });
  });

  describe('the NIGHT shift, which wraps past midnight', () => {
    it('is active late on its own date', () => {
      expect(computeShiftLabel([assignment({ shift: 'NIGHT', date: '2026-08-05' })], at('2026-08-05T23:30:00'))).toEqual({
        kind: 'active',
        time: '07:00',
      });
    });

    it('is STILL active in the small hours of the FOLLOWING day', () => {
      // The case a naive same-date comparison gets wrong: at 02:00 on the 6th the
      // clinician is on the shift dated the 5th.
      expect(computeShiftLabel([assignment({ shift: 'NIGHT', date: '2026-08-05' })], at('2026-08-06T02:00:00'))).toEqual({
        kind: 'active',
        time: '07:00',
      });
    });

    it('has ended by 06:00 the next morning', () => {
      expectNotActive(computeShiftLabel([assignment({ shift: 'NIGHT', date: '2026-08-05' })], at('2026-08-06T07:00:00')));
    });

    it('is not active earlier on its own date', () => {
      expectNotActive(computeShiftLabel([assignment({ shift: 'NIGHT', date: '2026-08-05' })], at('2026-08-05T10:00:00')));
    });

    it('wraps correctly across a month boundary', () => {
      expect(computeShiftLabel([assignment({ shift: 'NIGHT', date: '2026-07-31' })], at('2026-08-01T03:00:00'))).toMatchObject({
        kind: 'active',
      });
    });
  });

  describe('FLEXIBLE, which has no window', () => {
    it('covers its whole date', () => {
      expect(computeShiftLabel([assignment({ shift: 'FLEXIBLE' })], at('2026-08-05T23:00:00'))).toEqual({
        kind: 'flexible',
        date: '2026-08-05',
      });
    });

    it('is announced as an upcoming flexible day when it is in the future', () => {
      expect(computeShiftLabel([assignment({ shift: 'FLEXIBLE', date: '2026-08-07' })], at('2026-08-05T09:00:00'))).toEqual({
        kind: 'nextFlexible',
        date: '2026-08-07',
      });
    });

    it('never claims to be an active windowed shift', () => {
      expect(shiftWindowText('FLEXIBLE')).toBeNull();
    });
  });

  describe('the next upcoming shift', () => {
    it('reports later today', () => {
      expect(computeShiftLabel([assignment({ shift: 'EVENING' })], at('2026-08-05T09:00:00'))).toEqual({
        kind: 'next',
        date: '2026-08-05',
        time: '15:00',
      });
    });

    it('prefers the earliest date', () => {
      const label = computeShiftLabel(
        [assignment({ id: 'b', date: '2026-08-09', shift: 'DAY' }), assignment({ id: 'a', date: '2026-08-07', shift: 'DAY' })],
        at('2026-08-05T09:00:00'),
      );
      expect(label).toMatchObject({ date: '2026-08-07' });
    });

    it('prefers the earliest start when two fall on the same day', () => {
      const label = computeShiftLabel(
        [assignment({ id: 'b', shift: 'NIGHT' }), assignment({ id: 'a', shift: 'EVENING' })],
        at('2026-08-05T09:00:00'),
      );
      expect(label).toMatchObject({ time: '15:00' });
    });

    it('ignores shifts that have already finished', () => {
      expect(computeShiftLabel([assignment({ shift: 'DAY' })], at('2026-08-05T20:00:00'))).toBeNull();
    });

    it('prefers an ACTIVE shift over an upcoming one', () => {
      const label = computeShiftLabel(
        [assignment({ id: 'later', shift: 'NIGHT' }), assignment({ id: 'now', shift: 'DAY' })],
        at('2026-08-05T09:00:00'),
      );
      expect(label).toEqual({ kind: 'active', time: '15:00' });
    });
  });

  describe('selectShift agrees with computeShiftLabel', () => {
    // Regression. These were two separate selections: the label came from
    // computeShiftLabel while the Today card body took upcoming[0], which still
    // contains a shift that finished earlier today. At 15:54 with a morning shift
    // rostered, the card read "Next shift tomorrow 22:00" above the details of the
    // 06:00-14:00 shift that had already ended.
    it('does not feature a shift that has already finished today', () => {
      const finishedThisMorning = assignment({ id: 'done', shift: 'DAY', date: '2026-08-05' });
      const tomorrowNight = assignment({ id: 'next', shift: 'NIGHT', date: '2026-08-06' });
      const now = at('2026-08-05T15:54:00');

      const selected = selectShift([finishedThisMorning, tomorrowNight], now);

      expect(selected?.assignment.id).toBe('next');
      expect(computeShiftLabel([finishedThisMorning, tomorrowNight], now)).toMatchObject({ kind: 'next', date: '2026-08-06' });
    });

    it('features the ACTIVE shift while it is running', () => {
      const now = at('2026-08-05T09:00:00');
      const selected = selectShift([assignment({ id: 'now', shift: 'DAY' })], now);

      expect(selected).toMatchObject({ kind: 'active' });
      expect(selected?.assignment.id).toBe('now');
    });

    it('returns nothing exactly when the label does', () => {
      const cases: [DutyRosterAssignmentDto[], Date][] = [
        [[], at('2026-08-05T09:00:00')],
        [[assignment({ shift: 'DAY' })], at('2026-08-05T20:00:00')],
        [[assignment({ shift: 'DAY' })], at('2026-08-05T09:00:00')],
        [[assignment({ shift: 'FLEXIBLE' })], at('2026-08-05T23:00:00')],
      ];
      for (const [assignments, now] of cases) {
        expect(selectShift(assignments, now) === null).toBe(computeShiftLabel(assignments, now) === null);
      }
    });
  });

  describe('shiftWindowText', () => {
    it.each([
      ['DAY', '07:00–15:00'],
      ['EVENING', '15:00–23:00'],
      ['NIGHT', '23:00–07:00'],
    ] as const)('%s reads %s', (shift, expected) => {
      expect(shiftWindowText(shift)).toBe(expected);
    });

    it('has no window for FLEXIBLE, which spans the whole date', () => {
      expect(shiftWindowText('FLEXIBLE')).toBeNull();
    });
  });

  describe('isoDate', () => {
    it('formats in LOCAL time, not UTC', () => {
      // toISOString() would shift the date across midnight for anyone east or west
      // of UTC, putting a clinician on the wrong day's roster.
      const local = new Date(2026, 7, 5, 23, 30);
      expect(isoDate(local)).toBe('2026-08-05');
    });

    it('zero-pads single digits', () => {
      expect(isoDate(new Date(2026, 0, 3, 12))).toBe('2026-01-03');
    });
  });
});

/**
 * The URLs, which nothing tested until 2026-08-22.
 *
 * <p>Everything above this point is pure functions, so the suite was green while `myAssignments()`
 * called `api/duty-rosters/my` — a path that 404s. The Today tab's roster strip and Me → share my
 * roster were both empty in production, the comment above the URL argued the plural was right, and
 * `me.page.spec.ts` hardcoded the same wrong path. A stubbed API service cannot see a URL error;
 * only an HttpTestingController can.
 *
 * <p>Matched with `endsWith` on the path rather than the full absolute URL, because the base differs
 * per platform — `10.0.2.2` on the Android emulator, `localhost` elsewhere.
 */
describe('DutyRosterApiService — the paths', () => {
  let service: DutyRosterApiService;
  let httpMock: HttpTestingController;

  const BASE = 'services/professionalservice/api/duty-roster';

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(DutyRosterApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('asks for the SINGULAR resource, with no /my suffix', () => {
    // The bare GET is already scoped to the caller server-side; /all is the admin list and this
    // client must never reach it.
    service.myAssignments().subscribe();

    const request = httpMock.expectOne(r => r.method === 'GET' && r.url.endsWith(BASE));
    expect(request.request.url).not.toContain('duty-rosters');
    expect(request.request.url).not.toContain('/my');
    request.flush([]);
  });

  it('passes from and to as query parameters on a range read', () => {
    service.range('2026-08-01', '2026-08-31').subscribe();

    const request = httpMock.expectOne(r => r.method === 'GET' && r.url.endsWith(BASE));
    expect(request.request.params.get('from')).toBe('2026-08-01');
    expect(request.request.params.get('to')).toBe('2026-08-31');
    request.flush([]);
  });

  it('asks the summary for one year', () => {
    service.summary(2026).subscribe();

    const request = httpMock.expectOne(r => r.method === 'GET' && r.url.endsWith(`${BASE}/summary`));
    expect(request.request.params.get('year')).toBe('2026');
    request.flush([]);
  });

  it('encodes the date on a day read', () => {
    service.day('2026-08-22').subscribe();

    httpMock.expectOne(r => r.method === 'GET' && r.url.endsWith(`${BASE}/day/2026-08-22`)).flush([]);
  });
});
