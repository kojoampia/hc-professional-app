import { DUTY_ROSTER_SHIFTS, shiftWindowText } from './duty-roster-api.service';

/**
 * The shift windows this app shows, pinned to the values `web/` holds.
 *
 * <p><b>`SHIFT_WINDOWS` is defined twice in this product and nothing gated it.</b> The copy in
 * `duty-roster-api.service.ts` and the one in
 * `web/src/main/webapp/app/health-connect/health-connect.models.ts` are byte-identical, and the
 * comment on this app's copy records that it silently held the **pre-DR1** windows for an unknown
 * period — DAY 08–17 where it is 07:00–15:00, NIGHT an hour out at both ends, EVENING missing
 * entirely. A clinician on shift at 07:30 was told they were not on duty, and nothing failed.
 *
 * <p><b>This is a pin, not a cross-repo test, and the difference is worth stating plainly.</b>
 * Mobile CI clones one repo — the reason `case-status.spec.ts` and `shift-names.spec.ts` exist here
 * as second copies rather than as shared code — so nothing runnable from this checkout can read
 * `web/`'s table and compare. What this does instead is make either copy **impossible to change
 * quietly**: `web/`'s `shift-windows.spec.ts` is the same table under the same reasoning, so an
 * edit on either side fails that side's own suite and the failure names the other file. Two
 * independent pins is the closest a one-repo CI gets to an invariant across two, and it catches
 * exactly the failure that happened: one side moved and the other did not.
 *
 * <p>It does <b>not</b> catch both being edited to the same wrong value, and nothing here can.
 * `hc-professional/docs/backlog.md` item 9 says so rather than claiming otherwise.
 *
 * <p><b>Derived from `DUTY_ROSTER_SHIFTS`, so a new shift type has to be given an answer</b> rather
 * than defaulting to "no window" unnoticed. The two windowless values are asserted as windowless,
 * which is the half a `?? default` erases: `FLEXIBLE` covers its whole date and `OFF` is not worked
 * at all, so "is the hour inside the window" is the wrong question for both.
 */
describe('shift windows', () => {
  /**
   * Hours of the day as the card renders them, or `null` for a value with no window.
   *
   * <p>Kept as rendered strings rather than as `{ start, end }` so that this file and `web/`'s can
   * be read against each other by eye. NIGHT reads oddly and is correct: `23:00–07:00` wraps past
   * midnight, and an 01:00 moment belongs to the previous date's shift.
   */
  const WINDOWS: Record<(typeof DUTY_ROSTER_SHIFTS)[number], string | null> = {
    DAY: '07:00–15:00',
    EVENING: '15:00–23:00',
    NIGHT: '23:00–07:00',
    OFF: null,
    FLEXIBLE: null,
  };

  it('covers every shift the roster can send', () => {
    // The expectation is a record keyed by the union, so a missing key is a compile error rather
    // than a silent gap — this asserts the other direction, that nothing was added to the table
    // which the union no longer has.
    expect(Object.keys(WINDOWS).sort()).toEqual([...DUTY_ROSTER_SHIFTS].sort());
  });

  it.each(DUTY_ROSTER_SHIFTS)('%s renders its window, or none', shift => {
    expect(shiftWindowText(shift)).toBe(WINDOWS[shift]);
  });

  it('leaves exactly two values windowless', () => {
    // A count, because the number is what a `?? default` in a caller depends on. It was one until
    // OFF arrived on 2026-09-04, and two callers had been written assuming it would stay one.
    expect(DUTY_ROSTER_SHIFTS.filter(shift => shiftWindowText(shift) === null)).toEqual(['OFF', 'FLEXIBLE']);
  });
});
