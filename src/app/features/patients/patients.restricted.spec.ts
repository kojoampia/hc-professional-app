import { HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { provideRouter } from '@angular/router';

const disk = new Map<string, unknown>();
jest.mock('idb-keyval', () => ({
  get: jest.fn(async (key: string) => disk.get(key)),
  set: jest.fn(async (key: string, value: unknown) => void disk.set(key, value)),
  del: jest.fn(async (key: string) => void disk.delete(key)),
  keys: jest.fn(async () => [...disk.keys()]),
  clear: jest.fn(async () => disk.clear()),
}));

import { AccountService } from '../../core/auth/account.service';
import { PatientsPage } from './patients.page';

/**
 * What the directory actually says when the server withheld part of it — `../docs/backlog.md` 114.
 *
 * <h3>Why this renders the page rather than asserting on the store</h3>
 * `patients.store.spec.ts` proves the header reaches a signal. That is one layer below the defect:
 * Phase 6 shipped a complete filing feature that no template ever named, and the lesson written into
 * `reachable-members.spec.ts` was that a green store spec says nothing about what a clinician sees.
 * The sentence is the deliverable here, so the sentence is what is asserted.
 *
 * <p>`TranslateModule.forRoot()` loads no catalogue, so the pipe renders the key itself. That is a
 * feature for this file: asserting on `patients.recencyRestricted` pins which sentence was chosen,
 * not merely that some text appeared, and `restricted-parts.spec.ts` holds the four translations.
 *
 * <p>The list is in `ion-content` rather than in an `ion-modal`, so unlike the filing control it is
 * in the DOM jsdom builds and can be read here.
 */
describe('PatientsPage — a refused part is said, not left blank', () => {
  let httpMock: HttpTestingController;
  const account = signal<{ login: string; authorities: string[] } | null>({ login: 'pharmacist', authorities: ['ROLE_PHARMACIST'] });

  /** One row whose recency is null — which is what both a quiet caseload and a refusal look like. */
  const ROW = { id: 'p1', patientName: 'Ama Mensah', lastActivityAt: null, sex: 'female', isChild: false };

  /**
   * Lets the store's own promise chain run.
   *
   * <p>`fixture.whenStable()` is <b>not</b> enough here and returns with no request issued at all:
   * `refresh()` awaits the offline cache, whose seal/open go through Node's real WebCrypto (see
   * `setup-jest.ts`), and those promises resolve outside anything the zone counts as pending. A
   * macrotask turn is what actually waits — measured, not assumed.
   */
  const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

  /** Renders the directory against a server that named `header` as withheld, or named nothing. */
  const directory = async (header: string | null): Promise<HTMLElement> => {
    const fixture = TestBed.createComponent(PatientsPage);
    fixture.detectChanges();
    await settle();

    const request = httpMock.expectOne(candidate => candidate.url.includes('api/patients'));
    request.flush([ROW], {
      headers: new HttpHeaders(header === null ? { 'X-Total-Count': '1' } : { 'X-Total-Count': '1', 'X-Restricted-Parts': header }),
    });

    await settle();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(() => {
    disk.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PatientsPage, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: AccountService, useValue: { account } }],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('says nothing at all when nothing was withheld', async () => {
    const dom = await directory(null);

    // Five of the eight disciplines are here. The screen must be exactly as it was.
    expect(dom.querySelector('[data-test="rows-restricted"]')).toBeNull();
    expect(dom.textContent).not.toContain('patients.recencyRestricted');
    expect(dom.textContent).toContain('patients.neverSeen');
  });

  it('replaces "no activity recorded" with the refusal when the recency column was withheld', async () => {
    const dom = await directory('lastActivity');

    expect(dom.textContent).toContain('patients.recencyRestricted');
    // The whole defect in one assertion: a pharmacist was being told the caseload was quiet.
    expect(dom.textContent).not.toContain('patients.neverSeen');
  });

  it('does NOT claim patients are missing when only the column was withheld', async () => {
    const dom = await directory('lastActivity');

    // Two tokens, two severities. A blank field is not a missing person.
    expect(dom.querySelector('[data-test="rows-restricted"]')).toBeNull();
  });

  it('says rows are missing, above the list, when case assignments were withheld', async () => {
    const dom = await directory('caseAssignments');

    // Above the list rather than on a row: no row can describe a patient who is not in it.
    expect(dom.querySelector('[data-test="rows-restricted"]')?.textContent).toContain('patients.rowsRestricted');
  });

  it('says both, separately, for a technician', async () => {
    const dom = await directory('caseAssignments,lastActivity');

    expect(dom.querySelector('[data-test="rows-restricted"]')?.textContent).toContain('patients.rowsRestricted');
    expect(dom.textContent).toContain('patients.recencyRestricted');
  });

  it('renders nothing for a token it does not know, while still honouring the one it does', async () => {
    const dom = await directory('vitals,lastActivity');

    expect(dom.textContent).toContain('patients.recencyRestricted');
    expect(dom.textContent).not.toContain('vitals');
    expect(dom.querySelector('[data-test="rows-restricted"]')).toBeNull();
  });

  afterEach(() => {
    httpMock.match(() => true).forEach(request => request.flush([]));
  });
});
