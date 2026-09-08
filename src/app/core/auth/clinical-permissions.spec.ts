import { hasAnyClinicalRole, hasClinicalPermission } from './clinical-permissions';

/**
 * The read-only split, mirrored from the server.
 *
 * <p>`api/`'s SecurityConfiguration requires CLINICAL_MUTATION for POST/PUT/PATCH/DELETE on
 * `/api/**`, and `/api/patients/**` is deliberately not hoisted above it. If this file and that
 * matrix disagree, the phone offers a button the server refuses — or, with an offline queue in
 * play, holds a clinical note for hours before it is rejected.
 */
describe('clinical permissions', () => {
  it('lets a doctor file anything', () => {
    expect(hasClinicalPermission(['ROLE_DOCTOR'], 'manageActivity')).toBe(true);
    expect(hasClinicalPermission(['ROLE_DOCTOR'], 'manageReport')).toBe(true);
    expect(hasClinicalPermission(['ROLE_DOCTOR'], 'manageCase')).toBe(true);
  });

  it('lets an administrator file, because they work the review queue', () => {
    expect(hasClinicalPermission(['ROLE_ADMIN'], 'manageActivity')).toBe(true);
  });

  it.each(['ROLE_NURSE', 'ROLE_PARAMEDIC', 'ROLE_THERAPIST', 'ROLE_PHARMACIST'])('lets a %s file clinical content', authority => {
    expect(hasClinicalPermission([authority], 'manageActivity')).toBe(true);
  });

  it.each(['ROLE_CARER', 'ROLE_CHEMIST', 'ROLE_TECHNICIAN'])('REFUSES a %s — read-only in v1', authority => {
    expect(hasClinicalPermission([authority], 'manageActivity')).toBe(false);
    expect(hasClinicalPermission([authority], 'manageReport')).toBe(false);
    expect(hasClinicalPermission([authority], 'manageCase')).toBe(false);
  });

  it('lets a doctor archive a case', () => {
    expect(hasClinicalPermission(['ROLE_DOCTOR'], 'archiveCase')).toBe(true);
  });

  it('REFUSES an admin the archive, which is the one permission they do not hold', () => {
    // Not an oversight and not a tightening on our side: patientservice excludes ROLE_ADMIN from
    // /clinical-cases/{id}/archive deliberately, because retiring a clinical episode is a clinical
    // judgement and an admin already holds DELETE there. An admin passes every OTHER permission
    // here by the early return, so this is exactly the case a future refactor would break.
    expect(hasClinicalPermission(['ROLE_ADMIN'], 'archiveCase')).toBe(false);
    expect(hasClinicalPermission(['ROLE_ADMIN'], 'manageCase')).toBe(true);
  });

  it.each(['ROLE_NURSE', 'ROLE_PARAMEDIC', 'ROLE_THERAPIST', 'ROLE_PHARMACIST'])(
    'REFUSES a %s the archive though they may edit the same case',
    authority => {
      // ScopeOfPractice grants DIAGNOSIS to the doctor alone and a ClinicalCase maps to DIAGNOSIS.
      expect(hasClinicalPermission([authority], 'archiveCase')).toBe(false);
      expect(hasClinicalPermission([authority], 'manageCase')).toBe(true);
    },
  );

  it('refuses a bare ROLE_USER, which is what an applicant holds', () => {
    expect(hasClinicalPermission(['ROLE_USER'], 'manageActivity')).toBe(false);
  });

  it('refuses missing authorities without throwing', () => {
    expect(hasClinicalPermission(null, 'manageActivity')).toBe(false);
    expect(hasClinicalPermission(undefined, 'manageActivity')).toBe(false);
    expect(hasClinicalPermission([], 'manageActivity')).toBe(false);
  });

  it('lets a carer through the "any clinical role" check, since they are a clinician', () => {
    // The trap web/ records: an applicant holds ROLE_USER and nothing else, so "no clinical role"
    // is NOT a null check. A carer has a role; what they lack is a WRITE permission.
    expect(hasAnyClinicalRole(['ROLE_CARER'])).toBe(true);
    expect(hasAnyClinicalRole(['ROLE_USER'])).toBe(false);
  });
});

/**
 * `../docs/backlog.md` item 44 — an angel supports a patient and has no role in this app.
 *
 * `ROLE_ANGEL` was a ninth discipline in `AUTHORITY` until 2026-09-08. Removing it from that map is a
 * compile-time fact TypeScript already guarantees; **what these cases hold is the runtime one**, which
 * nothing about the deletion establishes. A token bearing the authority keeps arriving — hc-patient
 * issues it, all three gateways share one signing key, and an account on a long-lived database may
 * hold a grant made before the removal — so the question is what this app does with an authority it
 * does not recognise, and the answer must be *nothing offered*, not *nothing known, so assume yes*.
 *
 * Both functions already answer correctly by construction: they test membership of the held
 * authorities rather than resolving them to a role, so there is no default branch to fall through.
 * That is easy to lose in a refactor towards a role enum, which is why it is written down.
 */
describe('an authority this app does not recognise (item 44: ROLE_ANGEL)', () => {
  it('offers no clinical permission, alone or beside the base user authority', () => {
    for (const permission of ['manageActivity', 'manageReport', 'manageCase', 'archiveCase'] as const) {
      expect(hasClinicalPermission(['ROLE_ANGEL'], permission)).toBe(false);
      expect(hasClinicalPermission(['ROLE_USER', 'ROLE_ANGEL'], permission)).toBe(false);
    }
    // The control: without it this would pass on a function that refuses everybody.
    expect(hasClinicalPermission(['ROLE_USER', 'ROLE_NURSE'], 'manageActivity')).toBe(true);
  });

  it('is not a clinical role, so the shell treats the account as an applicant', () => {
    expect(hasAnyClinicalRole(['ROLE_ANGEL'])).toBe(false);
    expect(hasAnyClinicalRole(['ROLE_USER', 'ROLE_ANGEL'])).toBe(false);
  });
});
