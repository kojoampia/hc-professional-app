import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';

import { ApplicationConfigService } from '../config/application-config.service';
import { OnboardingApiService } from './onboarding-api.service';

/**
 * The two bases this service reads, pinned.
 *
 * ⛔ **Why this file exists at all: `mobile/` was a consumer of both surfaces and appeared in no
 * task.** `profile.md`'s step 3 moved the document list off `api/onboarding/documents` (T2) and its
 * step 4 moved the application off `api/onboarding/applications` (T3), and both of this app's calls
 * had to move with them. Nothing here asserted either URL, so a rename left behind would have been
 * invisible to every gate in this repository.
 *
 * ⚠ **And the symptom would not have been an error.** `myApplication` 404s as a matter of course —
 * a clinician who was seeded or invited rather than hired through the careers page has no
 * application — and `TodayPage` reads exactly that: a null application means "nothing to nag about".
 * So a call left on a dead path would have quietly retired the "finish your onboarding in the
 * portal" banner for everybody, with nothing thrown and nothing logged. **A consumer reading where
 * nobody writes is silence that looks like health.**
 *
 * ⚠ The `expectNone` on each old path is the half that makes this a gate rather than a
 * transcription: asserting the new URL alone would pass against a service that called both.
 */
describe('OnboardingApiService', () => {
  let service: OnboardingApiService;
  let httpMock: HttpTestingController;
  let applicationBase: string;
  let documentBase: string;
  let onboardingBase: string;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(OnboardingApiService);
    httpMock = TestBed.inject(HttpTestingController);
    const config = TestBed.inject(ApplicationConfigService);
    applicationBase = config.getEndpointFor('api/professional-application', 'professionalservice');
    documentBase = config.getEndpointFor('api/personal-document', 'professionalservice');
    onboardingBase = config.getEndpointFor('api/onboarding', 'professionalservice');
  });

  afterEach(() => httpMock.verify());

  it('should read the own application from the step 4 endpoint', () => {
    service.myApplication().subscribe();

    const req = httpMock.expectOne(`${applicationBase}/me`);
    expect(req.request.method).toBe('GET');
    httpMock.expectNone(`${onboardingBase}/applications/me`);
    req.flush({ id: 'app1', accountId: 'nurse', authority: 'ROLE_NURSE', status: 'ACTIVE' });
  });

  it('should read the own documents from the step 3 endpoint', () => {
    service.myDocuments().subscribe();

    const req = httpMock.expectOne(documentBase);
    expect(req.request.method).toBe('GET');
    httpMock.expectNone(`${onboardingBase}/documents`);
    req.flush([]);
  });

  /**
   * ⚠ **The renamed field, read off a body rather than off the interface.**
   *
   * `authority` was `requestedRole` until T3. A TypeScript rename is checked by `tsc` wherever the
   * field is *used*, and this app uses only `status` — so the interface could have kept the stale
   * name indefinitely with every gate green, and the first reader of the role would have got
   * `undefined`.
   */
  it('should carry the authority the server now sends', () => {
    let authority: string | undefined;
    service.myApplication().subscribe(application => (authority = application.authority));

    httpMock.expectOne(`${applicationBase}/me`).flush({ id: 'app1', accountId: 'nurse', authority: 'ROLE_PARAMEDIC', status: 'ACTIVE' });

    expect(authority).toBe('ROLE_PARAMEDIC');
  });
});
