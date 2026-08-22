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
