import { HttpHeaders, HttpResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { of, throwError } from 'rxjs';

import { PatientApiService, PatientRecordDto } from '../../core/api/patient-api.service';
import { CacheStore } from '../../core/offline/cache-store.service';
import { PreferencesService } from '../../core/native/preferences.service';
import { SecureTokenStore } from '../../core/native/secure-token-store.service';
import { WriteQueue } from '../../core/offline/write-queue.service';
import { PatientsStore } from './patients.store';

const disk = new Map<string, unknown>();
jest.mock('idb-keyval', () => ({
  get: jest.fn(async (key: string) => disk.get(key)),
  set: jest.fn(async (key: string, value: unknown) => void disk.set(key, value)),
  del: jest.fn(async (key: string) => void disk.delete(key)),
  keys: jest.fn(async () => [...disk.keys()]),
  clear: jest.fn(async () => disk.clear()),
}));

/**
 * What a patient's **record** says when the server withheld the activity log — `../docs/backlog.md`
 * item 126, and the copy trap item 129 records.
 *
 * <h3>The defect</h3>
 * `GET /api/patients/{id}` degrades for a pharmacist or a chemist since item 112: the record is
 * served **without the activity panel**, named in the same `X-Restricted-Parts` header the directory
 * carries. A client that ignores it renders `activities: []` as `patients.noActivity` — *"No activity
 * recorded."* — which is precisely what a patient nobody has touched looks like. On a list that
 * conflation cost a column; on a record it is a clinical reading, made while deciding what to do
 * next.
 *
 * <h3>One token, not two</h3>
 * `caseAssignments` never reaches this endpoint. A record whose case read was refused is not served
 * at all — item 112 refuses it outright, because that collection is what entitlement is decided
 * from. So the record asks about exactly one part, and the spec asserts that rather than assuming it.
 *
 * <h3>Why the sentence is asserted at source rather than in the DOM</h3>
 * The record lives inside an `ion-modal`, whose `ng-template` Ionic renders into an overlay jsdom
 * never instantiates — the constraint `patients.page.spec.ts` and `reachable-members.spec.ts` both
 * record, and the reason the password-reset screens became their own component.
 *
 * <p><b>Re-measured rather than inherited, while writing this file.</b> A throwaway spec drove the
 * page to a restricted record and read the DOM: the `<ion-modal>` element **is** there, and its
 * content is not — neither the marker nor the `patients.noActivity` note it replaces appears in
 * `textContent`. So a DOM assertion here would pass or fail for reasons that have nothing to do with
 * what a clinician sees, which is worse than not making it.
 *
 * <p>So the **decision** is asserted against the store here, the **wiring** against the page source,
 * and the **words** against the four catalogues in `restricted-parts.spec.ts`. None of the three
 * covers the defect alone.
 */
describe('PatientsStore — a refused activity log is said on the record, not left looking quiet', () => {
  let store: PatientsStore;
  let api: { query: jest.Mock; find: jest.Mock; appendActivity: jest.Mock; appendReport: jest.Mock };

  const RECORD = { id: 'p1', patientName: 'Ama Mensah', activities: [], cases: [], reports: [] } as unknown as PatientRecordDto;

  /** A record response with the header the server really sends, or with none at all. */
  const served = (header: string | null, body: PatientRecordDto = RECORD): HttpResponse<PatientRecordDto> =>
    new HttpResponse({ body, headers: new HttpHeaders(header === null ? {} : { 'X-Restricted-Parts': header }) });

  /**
   * The device's own storage, which outlives the process.
   *
   * <p>Declared outside {@link build} on purpose: a second `build()` is this spec's cold start, and
   * a cold start keeps the keystore and the encrypted database and loses only what was in memory.
   * Rebuilding these maps with it would throw away the sealing key, so every sealed record would
   * read back as absent — a harness failure that looks exactly like the cache not working.
   */
  let preferences: Map<string, string>;
  let secrets: Map<string, string>;

  const build = async (): Promise<void> => {
    api = {
      query: jest.fn(() => of(new HttpResponse({ body: [] }))),
      find: jest.fn(() => of(served(null))),
      appendActivity: jest.fn(() => of({ id: 'a1' })),
      appendReport: jest.fn(() => of({ id: 'r1' })),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: PatientApiService, useValue: api },
        { provide: WriteQueue, useValue: { register: jest.fn(), submit: jest.fn(), writes: () => [] } },
        {
          provide: PreferencesService,
          useValue: {
            get: async (k: string) => preferences.get(k) ?? null,
            set: async (k: string, v: string) => void preferences.set(k, v),
            remove: async (k: string) => void preferences.delete(k),
          },
        },
        {
          provide: SecureTokenStore,
          useValue: {
            readSecret: async (k: string) => secrets.get(k) ?? null,
            writeSecret: async (k: string, v: string) => void secrets.set(k, v),
          },
        },
      ],
    });
    await TestBed.inject(CacheStore).initialize('pharmacist');
    store = TestBed.inject(PatientsStore);
  };

  beforeEach(async () => {
    disk.clear();
    preferences = new Map<string, string>();
    secrets = new Map<string, string>();
    await build();
  });

  describe('reading the header', () => {
    it('says nothing when nothing was withheld — five of the eight disciplines never see the header', async () => {
      await store.openRecord('p1');

      expect(store.recordActivityRestricted()).toBe(false);
    });

    it('marks the activity panel as refused when the server named it', async () => {
      api.find.mockReturnValue(of(served('lastActivity')));

      await store.openRecord('p1');

      expect(store.recordActivityRestricted()).toBe(true);
    });

    it('IGNORES a token this release does not know', async () => {
      // Items 113 and 127 are open against the same reads, so a third token is a live possibility.
      // An older app must go on working rather than marking a panel it knows nothing about.
      api.find.mockReturnValue(of(served('vitals')));

      await store.openRecord('p1');

      expect(store.recordActivityRestricted()).toBe(false);
    });

    it('honours the token it knows while dropping the one it does not', async () => {
      api.find.mockReturnValue(of(served('vitals,lastActivity')));

      await store.openRecord('p1');

      expect(store.recordActivityRestricted()).toBe(true);
    });

    it('clears the mark when the same role opens a record the server served whole', async () => {
      // A marker that only ever goes on would outlive the refusal that caused it.
      api.find.mockReturnValue(of(served('lastActivity')));
      await store.openRecord('p1');

      api.find.mockReturnValue(of(served(null)));
      await store.openRecord('p2');

      expect(store.recordActivityRestricted()).toBe(false);
    });
  });

  describe('with no signal', () => {
    it('keeps the mark on a record served from the cache, rather than re-telling the lie', async () => {
      // This app is built around cold starts. Without the cached marker a pharmacist opening a saved
      // record in a basement is shown "No activity recorded" with nothing to say otherwise.
      api.find.mockReturnValue(of(served('lastActivity')));
      await store.openRecord('p1');

      await build();
      api.find.mockReturnValue(throwError(() => new Error('offline')));
      await store.openRecord('p1');

      expect(store.record()).toMatchObject({ id: 'p1' });
      expect(store.recordActivityRestricted()).toBe(true);
    });

    it('caches the mark IN THE CLEAR — it names a capability of the role, not anything about a patient', async () => {
      api.find.mockReturnValue(of(served('lastActivity')));

      await store.openRecord('p1');

      expect(JSON.stringify(disk.get('hpd:patients.recordRestrictedParts'))).toContain('lastActivity');
    });

    it('does not store the mark under the record prefix, which the cache bound counts and evicts', async () => {
      api.find.mockReturnValue(of(served('lastActivity')));

      await store.openRecord('p1');

      expect([...disk.keys()].filter(key => key.startsWith('hpd:patients.record.'))).toEqual(['hpd:patients.record.p1']);
    });

    it("writes only tokens this release understands, so the server's unknown one never reaches the disk", async () => {
      api.find.mockReturnValue(of(served('vitals,lastActivity')));

      await store.openRecord('p1');

      expect(disk.get('hpd:patients.recordRestrictedParts')).toMatchObject({ value: ['lastActivity'] });
    });

    it('PARSES the cached mark rather than matching it raw, so the cache and the wire agree', async () => {
      // Dropping an unknown cached token is unobservable through the one question the record asks
      // today — `['vitals'].includes('lastActivity')` is false whether it was parsed or not — so the
      // property is pinned where it does show: a cached form the parser has to normalise must still
      // raise the mark. It stops being unobservable the day a second known part reaches this read,
      // which is what items 113 and 127 are open about.
      disk.set('hpd:patients.recordRestrictedParts', { value: [' lastActivity '], fetchedAt: Date.now() });

      await build();
      api.find.mockReturnValue(throwError(() => new Error('offline')));
      await store.openRecord('p1');

      expect(store.recordActivityRestricted()).toBe(true);
    });

    it('raises no mark from a cached token this release does not know', async () => {
      // A negative control rather than a guard: nothing can make this go red on its own, because
      // "no mark" is also what an unread cache gives. It is here so the pair above is not read as
      // covering it.
      disk.set('hpd:patients.recordRestrictedParts', { value: ['vitals'], fetchedAt: Date.now() });

      await build();
      api.find.mockReturnValue(throwError(() => new Error('offline')));
      await store.openRecord('p1');

      expect(store.recordActivityRestricted()).toBe(false);
    });

    it('survives a cached mark of an unexpected shape rather than taking the record down', async () => {
      disk.set('hpd:patients.recordRestrictedParts', { value: 'lastActivity', fetchedAt: Date.now() });

      await expect(store.openRecord('p1')).resolves.toBeUndefined();
      expect(store.recordActivityRestricted()).toBe(false);
    });
  });

  describe('the record does not borrow the directory sentence — item 129', () => {
    const SOURCE = readFileSync(join(__dirname, 'patients.page.ts'), 'utf8');

    /**
     * The template alone, without the class docstring above it.
     *
     * <p>The docstring argues about both sentences by name, so counting over the whole file counts
     * prose — which is how the first version of the test below failed for a reason that had nothing
     * to do with what a clinician sees.
     */
    const TEMPLATE = SOURCE.slice(SOURCE.indexOf('  template: `'), SOURCE.indexOf('export class'));

    it('renders the record sentence, guarded by the record signal', () => {
      expect(TEMPLATE).toContain("'patients.activityRestricted' | translate");
      expect(TEMPLATE).toContain('store.recordActivityRestricted()');
    });

    it('does NOT print "no activity recorded" and the refusal from one branch', () => {
      // The whole defect: `patients.noActivity` is the quiet-patient sentence, and it must be
      // unreachable when the panel was withheld rather than sitting beside the marker.
      const activityPanel = TEMPLATE.slice(TEMPLATE.indexOf("'patients.activity' |"), TEMPLATE.indexOf("'patients.reports' |"));

      expect(activityPanel).toContain('patients.activityRestricted');
      expect(activityPanel).toContain('@else');
      expect(activityPanel.indexOf('patients.activityRestricted')).toBeLessThan(activityPanel.indexOf('@else'));
      expect(activityPanel.indexOf('@else')).toBeLessThan(activityPanel.indexOf('patients.noActivity'));
    });

    it('uses the list sentence in exactly one place, and it is not the record', () => {
      // Item 129's trap, made into a guard. Telling a pharmacist that recent-activity sorting is
      // unavailable, when the patient's whole history is missing, is a new false sentence written
      // while removing one.
      expect(TEMPLATE.match(/patients\.recencyRestricted/g)).toHaveLength(1);
      expect(TEMPLATE.slice(TEMPLATE.indexOf('<ion-modal'))).not.toContain('patients.recencyRestricted');
    });
  });
});
