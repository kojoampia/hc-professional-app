import { HttpHeaders, HttpResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

const disk = new Map<string, unknown>();
jest.mock('idb-keyval', () => ({
  get: jest.fn(async (key: string) => disk.get(key)),
  set: jest.fn(async (key: string, value: unknown) => void disk.set(key, value)),
  del: jest.fn(async (key: string) => void disk.delete(key)),
  keys: jest.fn(async () => [...disk.keys()]),
  clear: jest.fn(async () => disk.clear()),
}));

import { AccountService } from '../../core/auth/account.service';
import { PatientApiService, PatientListItemDto } from '../../core/api/patient-api.service';
import { CacheStore } from '../../core/offline/cache-store.service';
import { PreferencesService } from '../../core/native/preferences.service';
import { SecureTokenStore } from '../../core/native/secure-token-store.service';
import { WriteQueue } from '../../core/offline/write-queue.service';
import { PatientsPage } from './patients.page';
import { PatientsStore } from './patients.store';

/**
 * What the directory says when every record behind it will refuse — `../docs/backlog.md` item 132.
 *
 * <h3>The defect</h3>
 * `GET /api/patients` degrades for a technician and still serves a hundred rows, but
 * `GET /api/patients/{id}` answers **503** for every one of them: no clinical domain is in a
 * technician's scope, so the record path — which reads strictly rather than degrading — has nothing
 * it may compose. Item 128 put that on the wire as `X-Restricted-Follow-Ups: record`, emitted on
 * the **directory** and meaning *a part was withheld from this read that the record path cannot
 * tolerate losing*. Neither client read it, so the clinician learned it by tapping.
 *
 * <p>Measured live through the quality gateway while this was written: `record` for technician,
 * absent for pharmacist and for nurse.
 *
 * <h3>Why the banner is keyed on having rows</h3>
 * A technician with **zero tasks** gets the marker on a **zero-row** page, and item 128 asserted
 * that deliberately rather than suppressing it: suppression would make the wire value depend on
 * caseload, and this app caches the marker beside page zero, so it would appear and vanish as
 * shifts were assigned. The rule handed to the clients is therefore **key the banner on having rows
 * to describe** — a sentence about what happens when you tap a row needs a row.
 *
 * <h3>Why the page, and not only the store</h3>
 * The directory list lives in `ion-content` rather than in an `ion-modal`, so unlike the record
 * screen it *is* in the DOM jsdom builds and the sentence itself can be asserted. Nothing here has
 * to settle for a source-level check. `TranslateModule.forRoot()` loads no catalogue, so the pipe
 * renders the key — which pins **which** sentence was chosen; the four translations are held by
 * `core/api/restricted-parts.spec.ts`.
 */
describe('PatientsPage — a row that will not open says so before it is tapped', () => {
  let httpMock: HttpTestingController;
  const account = signal<{ login: string; authorities: string[] } | null>({ login: 'technician', authorities: ['ROLE_TECHNICIAN'] });

  const ROW: PatientListItemDto = { id: 'p1', patientName: 'Ama Mensah', lastActivityAt: null, sex: 'female', isChild: false };

  /** See `patients.restricted.spec.ts`: `whenStable()` returns before the cache's WebCrypto settles. */
  const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

  /** Renders the directory against a server that named `header` as a refused follow-up, or nothing. */
  const directory = async (header: string | null, rows: PatientListItemDto[] = [ROW]): Promise<HTMLElement> => {
    const fixture = TestBed.createComponent(PatientsPage);
    fixture.detectChanges();
    await settle();

    const request = httpMock.expectOne(candidate => candidate.url.endsWith('api/patients'));
    request.flush(rows, {
      headers: new HttpHeaders(
        header === null
          ? { 'X-Total-Count': String(rows.length) }
          : { 'X-Total-Count': String(rows.length), 'X-Restricted-Follow-Ups': header },
      ),
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

  it('says nothing at all when the records behind the rows do open', async () => {
    // The positive control. Seven of the eight disciplines are here, and the screen must be exactly
    // as it was — a notice that renders unconditionally is a worse defect than the silence it
    // replaces, because it tells a doctor their own caseload is closed to them.
    const dom = await directory(null);

    expect(dom.querySelector('[data-test="records-restricted"]')).toBeNull();
  });

  it('says the rows will not open, above the list, when the server named the record path', async () => {
    const dom = await directory('record');

    expect(dom.querySelector('[data-test="records-restricted"]')?.textContent).toContain('patients.recordsRestricted');
  });

  it('says NOTHING on an empty page, because there are no rows for the sentence to describe', async () => {
    // Item 128 emits the marker on a zero-row page deliberately — suppressing it server-side would
    // make the wire value depend on caseload, and this app caches it beside page zero. Keying the
    // banner on rows is the client half of that decision: a banner over an empty list describes
    // nothing, and the empty state already says there are no patients.
    const dom = await directory('record', []);

    expect(dom.querySelector('[data-test="records-restricted"]')).toBeNull();
  });

  it('IGNORES a token this release does not know', async () => {
    // The same rule `X-Restricted-Parts` has followed since item 114: a later `api/` may name a
    // second follow-up, and an older app must go on working rather than rendering a wire token or a
    // missing translation key at a clinician.
    const dom = await directory('dossier');

    expect(dom.querySelector('[data-test="records-restricted"]')).toBeNull();
    expect(dom.textContent).not.toContain('dossier');
  });

  it('honours the token it knows while dropping the one it does not', async () => {
    const dom = await directory('dossier,record');

    expect(dom.querySelector('[data-test="records-restricted"]')?.textContent).toContain('patients.recordsRestricted');
  });

  it('does not reuse either sentence the directory already had for a withheld part', async () => {
    // Item 129's trap, third time. `recencyRestricted` says a column is blank and `rowsRestricted`
    // says people are missing; neither is "tapping this does nothing".
    const dom = await directory('record');

    expect(dom.textContent).not.toContain('patients.rowsRestricted');
    expect(dom.textContent).not.toContain('patients.recencyRestricted');
  });

  describe('the tap itself', () => {
    const tap = async (dom: HTMLElement): Promise<void> => {
      dom.querySelector('[data-test="patient-p1"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await settle();
    };

    it('opens the record when nothing said it would refuse', async () => {
      // The positive control for the guard below: without it, "no request was made" would pass on a
      // page whose rows never opened at all.
      await tap(await directory(null));

      expect(httpMock.match(candidate => candidate.url.endsWith('api/patients/p1'))).toHaveLength(1);
    });

    it('does NOT issue a read it has been told will 503', async () => {
      // On a phone the tap IS the interaction, so a row that stays a live target is itself a claim.
      // The server has already said this read refuses, and spending a clinician's mobile data to be
      // told so again — then showing "Could not load this record", which reads as transient — is
      // the state item 128 was filed to end.
      await tap(await directory('record'));

      expect(httpMock.match(candidate => candidate.url.endsWith('api/patients/p1'))).toEqual([]);
    });

    /**
     * `ion-item`'s own `button` property, read off the element.
     *
     * <p><b>Not `ng-reflect-button`</b>, which the first version of these two tests used. That
     * attribute bites today and would have gone on biting, but it is written by `ngDevMode` and is
     * no part of Angular's contract — an assertion that silently stops meaning anything if the build
     * mode changes, and stops by passing. The property is Ionic's public API for this element, is
     * what the component actually reads, and was measured to carry `true`/`false` here rather than
     * being swallowed by the Angular wrapper.
     */
    const affordance = (dom: HTMLElement): unknown =>
      (dom.querySelector('[data-test="patient-p1"]') as unknown as Record<string, unknown> | null)?.['button'];

    it('drops the row s button affordance, so nothing offers a door that is not there', async () => {
      // Ionic draws the ripple, the pressed state and (in ios mode) the chevron off `button`.
      expect(affordance(await directory('record'))).toBe(false);
    });

    it('keeps the affordance on a row that does open', async () => {
      // The positive control for the assertion above: without it, `toBe(false)` would also pass
      // against a row that was never a button in any state.
      expect(affordance(await directory(null))).toBe(true);
    });
  });

  afterEach(() => {
    httpMock.match(() => true).forEach(request => request.flush([]));
  });
});

/**
 * The half of item 132 that outlives the process: what a cold start with no signal says.
 *
 * <p>Driven against the store rather than the page because the cache is what is under test, and
 * because a cold start here is a second `build()` — which the page fixture has no way to express.
 */
describe('PatientsStore — the refused follow-up survives a cold start, and is re-parsed on the way out', () => {
  let store: PatientsStore;
  let api: { query: jest.Mock; find: jest.Mock; appendActivity: jest.Mock; appendReport: jest.Mock };

  const ROW: PatientListItemDto = { id: 'p1', patientName: 'Ama Mensah', lastActivityAt: null, sex: 'female', isChild: false };

  const served = (header: string | null, rows: PatientListItemDto[] = [ROW]): HttpResponse<PatientListItemDto[]> =>
    new HttpResponse({
      body: rows,
      headers: new HttpHeaders(
        header === null
          ? { 'X-Total-Count': String(rows.length) }
          : { 'X-Total-Count': String(rows.length), 'X-Restricted-Follow-Ups': header },
      ),
    });

  /** Outside {@link build}, so a rebuild is a cold start rather than a new device. */
  let preferences: Map<string, string>;
  let secrets: Map<string, string>;

  const build = async (): Promise<void> => {
    api = {
      query: jest.fn(() => of(served(null))),
      find: jest.fn(() => of(new HttpResponse({ body: { id: 'p1' } }))),
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
    await TestBed.inject(CacheStore).initialize('technician');
    store = TestBed.inject(PatientsStore);
  };

  beforeEach(async () => {
    disk.clear();
    preferences = new Map<string, string>();
    secrets = new Map<string, string>();
    await build();
  });

  it('caches the refusal IN THE CLEAR — it names a capability of the role, not anything about a patient', async () => {
    api.query.mockReturnValue(of(served('record')));

    await store.refresh();

    expect(disk.get('hpd:patients.restrictedFollowUps')).toMatchObject({ value: ['record'] });
  });

  it("writes only tokens this release understands, so the server's unknown one never reaches the disk", async () => {
    // This is where dropping an unknown WIRE token is observable at all, and it took a mutation to
    // find that out: `rowsUnopenable` asks `includes('record')`, which answers false for `dossier`
    // whether the token was dropped or carried, so the page-level "ignores it" test above passes
    // against an implementation that never parses. Item 126 found the same vacuity on the cache
    // side. The disk is the difference — an unparsed token written today is read back tomorrow by a
    // release that may have learned the word, and would then mark rows on a cached answer no server
    // stands behind.
    api.query.mockReturnValue(of(served('dossier,record')));

    await store.refresh();

    expect(disk.get('hpd:patients.restrictedFollowUps')).toMatchObject({ value: ['record'] });
  });

  it('keeps the sentence on a cold start with no signal, rather than offering a hundred dead rows again', async () => {
    api.query.mockReturnValue(of(served('record')));
    await store.refresh();

    await build();
    api.query.mockReturnValue(throwError(() => new Error('offline')));
    await store.refresh();

    expect(store.rows()).toHaveLength(1);
    expect(store.rowsUnopenable()).toBe(true);
  });

  it('PARSES the cached token rather than matching it raw, so the cache and the wire agree', async () => {
    // Item 126 found the vacuous version of this test: dropping an unknown cached token is
    // unobservable through a single `includes`. The property is pinned where it does show — a cached
    // form the parser has to normalise must still raise the sentence — so removing the parse turns
    // ` record ` into a token nothing matches and this goes red.
    disk.set('hpd:patients.restrictedFollowUps', { value: [' record '], fetchedAt: Date.now() });
    disk.set('hpd:patients.firstPage', { value: [ROW], fetchedAt: Date.now() });

    await build();
    api.query.mockReturnValue(throwError(() => new Error('offline')));
    await store.refresh();

    expect(store.rowsUnopenable()).toBe(true);
  });

  it('raises nothing from a cached token this release does not know', async () => {
    // A NEGATIVE CONTROL, not a guard: nothing can redden it on its own, because "no sentence" is
    // also what an unread cache gives. It is here so the test above is not read as covering it.
    disk.set('hpd:patients.restrictedFollowUps', { value: ['dossier'], fetchedAt: Date.now() });
    disk.set('hpd:patients.firstPage', { value: [ROW], fetchedAt: Date.now() });

    await build();
    api.query.mockReturnValue(throwError(() => new Error('offline')));
    await store.refresh();

    expect(store.rowsUnopenable()).toBe(false);
  });

  it('survives a cached entry of an unexpected shape rather than taking the directory down', async () => {
    // `refresh()` is awaited by `ngOnInit` and nothing catches around this read.
    disk.set('hpd:patients.restrictedFollowUps', { value: 'record', fetchedAt: Date.now() });
    api.query.mockReturnValue(of(served(null)));

    await expect(store.refresh()).resolves.toBeUndefined();
    expect(store.rowsUnopenable()).toBe(false);
  });

  it('corrects a cached refusal once the server stops sending it', async () => {
    // A marker that only ever goes on would outlive the rule that caused it — a discipline whose
    // scope was widened would go on being told its own records are closed.
    disk.set('hpd:patients.restrictedFollowUps', { value: ['record'], fetchedAt: Date.now() });
    api.query.mockReturnValue(of(served(null)));

    await store.refresh();

    expect(store.rowsUnopenable()).toBe(false);
    expect(disk.get('hpd:patients.restrictedFollowUps')).toMatchObject({ value: [] });
  });

  it('KEEPS the refusal when a later page fails — it belongs to the role, not to the request', async () => {
    api.query.mockReturnValueOnce(of(served('record')));
    await store.refresh();
    api.query.mockReturnValue(throwError(() => new Error('offline')));

    await store.loadMore();

    expect(store.rowsUnopenable()).toBe(true);
  });

  it('says nothing while the page is empty, though the marker did arrive', async () => {
    // The empty-page rule again, held one layer below the template. That the marker WAS read and
    // kept is proved through the cache, and that is the only proof available on purpose: the raw
    // token list is private, so `rowsUnopenable` is the one way to ask and nothing can key a chip or
    // a header badge on the tokens alone. The two answers genuinely differ on this page, which is
    // exactly why only one of them is offered.
    api.query.mockReturnValue(of(served('record', [])));

    await store.refresh();

    expect(disk.get('hpd:patients.restrictedFollowUps')).toMatchObject({ value: ['record'] });
    expect(store.rowsUnopenable()).toBe(false);
  });
});
