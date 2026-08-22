/**
 * Which clinical roles may write, and to what.
 *
 * <p>Copied from `web/src/main/webapp/app/health-connect/authority-role.ts` (web commit `639321a`),
 * reduced to the question this app actually asks. See the drift log in `CLAUDE.md` — this is the
 * first <b>behavioural</b> copy from `web/`, not another set of design tokens, so it drifts in a way
 * a screenshot will never show.
 *
 * <h3>This mirrors the server; it does not replace it</h3>
 * `api/`'s `SecurityConfiguration` requires `CLINICAL_MUTATION` for `POST|PUT|PATCH|DELETE /api/**`,
 * and `/api/patients/**` is deliberately not hoisted above that rule. So a carer's write is refused
 * by the server whatever this file says. What this buys is the difference between a button that
 * fails with a 403 and a button that is not offered — and, with an offline queue in play, between a
 * note that is queued for hours before being rejected and one that was never accepted.
 *
 * <h3>The asymmetry is deliberate and easy to get wrong</h3>
 * Admin and doctor may do everything. Nurse, paramedic, therapist and pharmacist may manage cases,
 * activities and reports — but <b>not</b> patients or the duty roster. Carer, angel, chemist and
 * technician are read-only in v1.
 */

/** The nine clinical authorities plus the two the gateway issues to everyone. */
export const AUTHORITY = {
  ADMIN: 'ROLE_ADMIN',
  USER: 'ROLE_USER',
  DOCTOR: 'ROLE_DOCTOR',
  NURSE: 'ROLE_NURSE',
  PARAMEDIC: 'ROLE_PARAMEDIC',
  PHARMACIST: 'ROLE_PHARMACIST',
  THERAPIST: 'ROLE_THERAPIST',
  CARER: 'ROLE_CARER',
  ANGEL: 'ROLE_ANGEL',
  CHEMIST: 'ROLE_CHEMIST',
  TECHNICIAN: 'ROLE_TECHNICIAN',
} as const;

/**
 * Roles that may file clinical content without being admin or doctor.
 *
 * <p>Matches `AuthoritiesConstants.CLINICAL_MUTATION` in `api/` minus the two above, which are
 * handled by the early return. If these two lists disagree, the phone offers a button the server
 * refuses — or hides one it would have accepted.
 */
const CLINICAL_MUTATION_ROLES: readonly string[] = [
  AUTHORITY.NURSE,
  AUTHORITY.PARAMEDIC,
  AUTHORITY.THERAPIST,
  AUTHORITY.PHARMACIST,
];

/** What a clinician might want to do. Only the three this app offers are listed. */
export type ClinicalPermission = 'manageActivity' | 'manageReport' | 'manageCase';

/**
 * Whether these authorities may perform this action.
 *
 * <p>Admin and doctor return true by an early return rather than by being in the set above, which is
 * how `web/` expresses it too — they hold permissions beyond the three named here, and folding them
 * into the set would quietly widen what the set means.
 */
export function hasClinicalPermission(authorities: readonly string[] | null | undefined, permission: ClinicalPermission): boolean {
  const held = authorities ?? [];
  if (held.includes(AUTHORITY.ADMIN) || held.includes(AUTHORITY.DOCTOR)) {
    return true;
  }
  return (
    CLINICAL_MUTATION_ROLES.some(role => held.includes(role)) &&
    (permission === 'manageActivity' || permission === 'manageReport' || permission === 'manageCase')
  );
}

/**
 * Whether the account holds any clinical role at all.
 *
 * <p>Note the trap `web/` records: an applicant holds `ROLE_USER` and nothing else, so "no clinical
 * role" is <b>not</b> a null check. Written as one it silently matches nobody.
 */
export function hasAnyClinicalRole(authorities: readonly string[] | null | undefined): boolean {
  const held = authorities ?? [];
  return Object.values(AUTHORITY).some(authority => authority !== AUTHORITY.USER && held.includes(authority));
}
