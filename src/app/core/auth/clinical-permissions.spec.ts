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

  it.each(['ROLE_CARER', 'ROLE_ANGEL', 'ROLE_CHEMIST', 'ROLE_TECHNICIAN'])('REFUSES a %s — read-only in v1', authority => {
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
