import { DutyRosterAssignmentDto, computeShiftLabel, isoDate, selectShift, shiftWindowText } from './duty-roster-api.service';

/**
 * Shift-window logic, ported with `computeShiftLabel` from
 * `web/.../duty-roster-assignments.service.ts` (web commit 48a12fc).
 *
 * These windows are a cross-repo invariant documented on `api/domain/enumeration/ShiftType`:
 * MORNING 06–14, AFTERNOON 14–22, NIGHT 22–06 (wraps), DAY 08–17, FLEXIBLE none.
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
    shift: over.shift ?? 'MORNING',
    name: over.name ?? 'Ward B',
    description: null,
  });

  it('returns nothing when there is nothing assigned', () => {
    expect(computeShiftLabel([], at('2026-08-05T09:00:00'))).toBeNull();
  });

  describe('an active shift', () => {
    it('reports the end of a MORNING shift during it', () => {
      const label = computeShiftLabel([assignment({ shift: 'MORNING' })], at('2026-08-05T09:00:00'));
      expect(label).toEqual({ kind: 'active', time: '14:00' });
    });

    it('is active at the very start of the window', () => {
      expect(computeShiftLabel([assignment({ shift: 'MORNING' })], at('2026-08-05T06:00:00'))).toMatchObject({ kind: 'active' });
    });

    it('is NOT active at the very end — the window is half-open', () => {
      // 14:00 belongs to AFTERNOON, not MORNING. An inclusive end would report two
      // active shifts at the changeover.
      expectNotActive(computeShiftLabel([assignment({ shift: 'MORNING' })], at('2026-08-05T14:00:00')));
    });

    it('handles DAY', () => {
      expect(computeShiftLabel([assignment({ shift: 'DAY' })], at('2026-08-05T12:00:00'))).toEqual({ kind: 'active', time: '17:00' });
    });
  });

  describe('the NIGHT shift, which wraps past midnight', () => {
    it('is active late on its own date', () => {
      expect(computeShiftLabel([assignment({ shift: 'NIGHT', date: '2026-08-05' })], at('2026-08-05T23:30:00'))).toEqual({
        kind: 'active',
        time: '06:00',
      });
    });

    it('is STILL active in the small hours of the FOLLOWING day', () => {
      // The case a naive same-date comparison gets wrong: at 02:00 on the 6th the
      // clinician is on the shift dated the 5th.
      expect(computeShiftLabel([assignment({ shift: 'NIGHT', date: '2026-08-05' })], at('2026-08-06T02:00:00'))).toEqual({
        kind: 'active',
        time: '06:00',
      });
    });

    it('has ended by 06:00 the next morning', () => {
      expectNotActive(computeShiftLabel([assignment({ shift: 'NIGHT', date: '2026-08-05' })], at('2026-08-06T06:00:00')));
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
      expect(computeShiftLabel([assignment({ shift: 'AFTERNOON' })], at('2026-08-05T09:00:00'))).toEqual({
        kind: 'next',
        date: '2026-08-05',
        time: '14:00',
      });
    });

    it('prefers the earliest date', () => {
      const label = computeShiftLabel(
        [assignment({ id: 'b', date: '2026-08-09', shift: 'MORNING' }), assignment({ id: 'a', date: '2026-08-07', shift: 'MORNING' })],
        at('2026-08-05T09:00:00'),
      );
      expect(label).toMatchObject({ date: '2026-08-07' });
    });

    it('prefers the earliest start when two fall on the same day', () => {
      const label = computeShiftLabel(
        [assignment({ id: 'b', shift: 'NIGHT' }), assignment({ id: 'a', shift: 'AFTERNOON' })],
        at('2026-08-05T09:00:00'),
      );
      expect(label).toMatchObject({ time: '14:00' });
    });

    it('ignores shifts that have already finished', () => {
      expect(computeShiftLabel([assignment({ shift: 'MORNING' })], at('2026-08-05T20:00:00'))).toBeNull();
    });

    it('prefers an ACTIVE shift over an upcoming one', () => {
      const label = computeShiftLabel(
        [assignment({ id: 'later', shift: 'NIGHT' }), assignment({ id: 'now', shift: 'MORNING' })],
        at('2026-08-05T09:00:00'),
      );
      expect(label).toEqual({ kind: 'active', time: '14:00' });
    });
  });

  describe('selectShift agrees with computeShiftLabel', () => {
    // Regression. These were two separate selections: the label came from
    // computeShiftLabel while the Today card body took upcoming[0], which still
    // contains a shift that finished earlier today. At 15:54 with a morning shift
    // rostered, the card read "Next shift tomorrow 22:00" above the details of the
    // 06:00-14:00 shift that had already ended.
    it('does not feature a shift that has already finished today', () => {
      const finishedThisMorning = assignment({ id: 'done', shift: 'MORNING', date: '2026-08-05' });
      const tomorrowNight = assignment({ id: 'next', shift: 'NIGHT', date: '2026-08-06' });
      const now = at('2026-08-05T15:54:00');

      const selected = selectShift([finishedThisMorning, tomorrowNight], now);

      expect(selected?.assignment.id).toBe('next');
      expect(computeShiftLabel([finishedThisMorning, tomorrowNight], now)).toMatchObject({ kind: 'next', date: '2026-08-06' });
    });

    it('features the ACTIVE shift while it is running', () => {
      const now = at('2026-08-05T09:00:00');
      const selected = selectShift([assignment({ id: 'now', shift: 'MORNING' })], now);

      expect(selected).toMatchObject({ kind: 'active' });
      expect(selected?.assignment.id).toBe('now');
    });

    it('returns nothing exactly when the label does', () => {
      const cases: [DutyRosterAssignmentDto[], Date][] = [
        [[], at('2026-08-05T09:00:00')],
        [[assignment({ shift: 'MORNING' })], at('2026-08-05T20:00:00')],
        [[assignment({ shift: 'MORNING' })], at('2026-08-05T09:00:00')],
        [[assignment({ shift: 'FLEXIBLE' })], at('2026-08-05T23:00:00')],
      ];
      for (const [assignments, now] of cases) {
        expect(selectShift(assignments, now) === null).toBe(computeShiftLabel(assignments, now) === null);
      }
    });
  });

  describe('shiftWindowText', () => {
    it.each([
      ['MORNING', '06:00–14:00'],
      ['AFTERNOON', '14:00–22:00'],
      ['NIGHT', '22:00–06:00'],
      ['DAY', '08:00–17:00'],
    ] as const)('%s reads %s', (shift, expected) => {
      expect(shiftWindowText(shift)).toBe(expected);
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
