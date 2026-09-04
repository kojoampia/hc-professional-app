import { DUTY_ROSTER_SHIFTS } from '../api/duty-roster-api.service';

import { CATALOGUES, SUPPORTED_LANGUAGES } from './catalogues';

/**
 * That every duty-roster shift has a name in every bundled catalogue, and that no catalogue names
 * one the server can no longer send.
 *
 * <p>The sibling of `web/`'s `shift-names.spec.ts`, and it exists as a **second** copy rather than a
 * shared one for the reason `case-status.spec.ts` gives: **mobile CI clones one repo.** Nothing in
 * `web/` or `api/` is on the checkout that runs this, so a check living there cannot see this app's
 * union, its catalogues, or the fact that the two agree. `hc-professional/docs/backlog.md` item 9
 * named this file as the thing that buys this repo the same gate; before it, the shift vocabulary
 * here was the hand-carried part of a cross-repo invariant, and it had already been wrong once —
 * `duty-roster-api.service` held the pre-DR1 windows for an unknown period with everything green.
 *
 * <p><b>Both directions, and both fail quietly without this.</b> ngx-translate renders a missing key
 * as the key itself, so a new value puts the literal `shiftType.OFF` on the Today card and throws
 * nothing. A retired value leaves a key that reads perfectly and translates a shift nothing will
 * ever send again — which is exactly what DR1 did to `api/.jhipster/DutyRoster.json`, where MORNING
 * and AFTERNOON survived their own deletion for a fortnight.
 *
 * <p><b>The expectation is derived, never listed</b> — from {@link DUTY_ROSTER_SHIFTS} and from
 * `SUPPORTED_LANGUAGES`. That is why the shifts are a `const` array with `DutyRosterShift` derived
 * from it rather than the other way round: a union of string literals cannot be enumerated at
 * runtime, so no test can ask it anything. Adding a value to the service fails this spec in all four
 * languages until the catalogues carry it, with nobody having edited this file.
 *
 * <p><b>What this still cannot see.</b> The authority is `ShiftType` in `api/`, which is not on this
 * checkout either. This holds the catalogues to *this app's* mirror of that enum; the link from the
 * mirror to the enum is made by hand, in one coordinated change across six repositories.
 *
 * @see catalogues.spec.ts, which checks key *parity* across languages — a shift missing from all
 *     four is parity-clean and caught only here.
 */
describe('duty-roster shift names', () => {
  const shiftNames = (language: keyof typeof CATALOGUES): Record<string, unknown> =>
    CATALOGUES[language].shiftType as unknown as Record<string, unknown>;

  it('has shifts to check', () => {
    // A derived expectation over an empty list asserts nothing at all, quietly and forever.
    expect(DUTY_ROSTER_SHIFTS.length).toBeGreaterThan(0);
  });

  it.each(SUPPORTED_LANGUAGES)('has a %s name for every shift', language => {
    // Named rather than counted, so a failure says which key to write.
    expect(DUTY_ROSTER_SHIFTS.filter(shift => !shiftNames(language)[shift])).toEqual([]);
  });

  it.each(SUPPORTED_LANGUAGES)('names no shift %s no longer has', language => {
    const retired = Object.keys(shiftNames(language)).filter(
      key => !DUTY_ROSTER_SHIFTS.includes(key as (typeof DUTY_ROSTER_SHIFTS)[number]),
    );

    expect(retired).toEqual([]);
  });

  it.each(SUPPORTED_LANGUAGES)('has no blank or key-echoing %s name', language => {
    const names = shiftNames(language);

    // A key copied into the catalogue to silence the check above passes it and still puts
    // `shiftType.NIGHT` on the screen. An echo has two shapes and only one of them contains the
    // word `shiftType`: the whole dotted path, and the bare `NIGHT` somebody pastes when filling a
    // language in a hurry. Both are caught here.
    const echoes = (name: string, shift: string): boolean => name === shift || name.includes('shiftType');

    expect(DUTY_ROSTER_SHIFTS.filter(shift => String(names[shift]).trim() === '' || echoes(String(names[shift]), shift))).toEqual([]);
  });

  it('translates the shifts differently from one another in English', () => {
    const names = shiftNames('en');

    expect(new Set(DUTY_ROSTER_SHIFTS.map(shift => names[shift])).size).toBe(DUTY_ROSTER_SHIFTS.length);
  });
});
