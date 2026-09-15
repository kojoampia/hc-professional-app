import { provideHttpClient } from '@angular/common/http';
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
import { PatientsStore } from './patients.store';
import { PatientsPage } from './patients.page';

/**
 * Who this page offers filing to, and that it offers it at all.
 *
 * <h3>Why this file exists</h3>
 * Phase 6 shipped patient filing complete — store method, queue op, API call, permission gate and a
 * full-screen form — and **nothing opened it**. `canFile()` was never referenced by the template,
 * `openFiling()` was never called. Unreachable in the running app, found by looking for the button
 * on a phone. In its place sat a line from Phase 5 naming a translation key that had never been
 * added, so a clinical record ended in the literal text `patients.readOnly`.
 *
 * <p>The only spec for the feature was `patients.store.spec.ts`, which calls `store.fileActivity()`
 * directly — one layer below the missing wiring. Green tests, dead feature. There was no page spec.
 *
 * <h3>What is checked where</h3>
 * The control lives inside an `ion-modal`, whose `ng-template` Ionic renders into an overlay that
 * jsdom never instantiates — the same constraint that made the password-reset screens their own
 * component. A DOM assertion for that button cannot run here, so this file asserts the **decision**
 * (who may file) and `reachable-members.spec.ts` asserts the **wiring** (that the template names
 * `canFile` and `openFiling` at all). Together they cover what broke; neither does alone.
 */
describe('PatientsPage — who may file', () => {
  let httpMock: HttpTestingController;
  const account = signal<{ login: string; authorities: string[] } | null>(null);

  function pageAs(authorities: string[] | null): PatientsPage {
    account.set(authorities ? { login: 'someone', authorities } : null);
    const fixture = TestBed.createComponent(PatientsPage);
    fixture.detectChanges();
    httpMock.match(() => true).forEach(request => request.flush([]));
    return fixture.componentInstance;
  }

  beforeEach(() => {
    disk.clear();
    account.set(null);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PatientsPage, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: AccountService, useValue: { account } }],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  it.each([['ROLE_DOCTOR'], ['ROLE_NURSE'], ['ROLE_PARAMEDIC'], ['ROLE_THERAPIST'], ['ROLE_PHARMACIST'], ['ROLE_ADMIN']])(
    'offers filing to %s',
    role => {
      expect(pageAs([role]).canFile()).toBe(true);
    },
  );

  it.each([['ROLE_CARER'], ['ROLE_CHEMIST'], ['ROLE_TECHNICIAN']])('withholds filing from %s', role => {
    // The three read-only roles in v1. The server refuses their writes whatever this says; the point
    // is to not offer a button the queue would hold for hours before it is rejected.
    expect(pageAs([role]).canFile()).toBe(false);
  });

  it('withholds filing from a token bearing ROLE_ANGEL, which this app does not know', () => {
    // Not a read-only role — not a role here at all since 2026-09-08 (../docs/backlog.md item 44).
    // hc-patient still issues it and the three gateways share one signing key, so it keeps arriving;
    // an unrecognised authority must offer nothing rather than fall through to a default.
    expect(pageAs(['ROLE_ANGEL']).canFile()).toBe(false);
    expect(pageAs(['ROLE_USER', 'ROLE_ANGEL']).canFile()).toBe(false);
  });

  it('withholds filing from an applicant holding only ROLE_USER', () => {
    // The trap web/ records: "no clinical role" is not a null check — an applicant has ROLE_USER.
    expect(pageAs(['ROLE_USER']).canFile()).toBe(false);
  });

  it('withholds filing when there is no account at all', () => {
    expect(pageAs(null).canFile()).toBe(false);
  });

  it('opens the form, and starts it empty so the last note is not re-filed', () => {
    const page = pageAs(['ROLE_NURSE']);
    page.activityTitle = 'left over from last time';

    page.openFiling();

    expect(page.filing()).toBe(true);
    expect(page.activityTitle).toBe('');
  });

  afterEach(() => {
    httpMock.match(() => true).forEach(request => request.flush([]));
  });
});

/**
 * That an unsent entry reaches the record, in the list it belongs to.
 *
 * <h3>Why this is asserted on the component and not in the DOM</h3>
 * The record is an `ion-modal`, whose `ng-template` Ionic renders into an overlay jsdom never
 * instantiates — the same constraint the filing button hit. So the split is asserted here, the
 * template's naming of it by `reachable-members.spec.ts`, and the chip's own rendering by
 * `shared-components.spec.ts`. The store's half is `patients.store.spec.ts`, which is precisely
 * where this stopped before: green at store level, on no screen (`../docs/backlog.md` item 122).
 */
describe('PatientsPage — unsent entries on the record', () => {
  const pending = signal<{ write: { id: string }; patientId: string; kind: 'activity' | 'report'; label: string; state: string }[]>([]);

  const entry = (kind: 'activity' | 'report', label: string, id = label): { write: { id: string } } & Record<string, unknown> => ({
    write: { id },
    patientId: 'p1',
    kind,
    label,
    state: 'pending',
  });

  function page(): PatientsPage {
    const fixture = TestBed.createComponent(PatientsPage);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    pending.set([]);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PatientsPage, TranslateModule.forRoot()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AccountService, useValue: { account: signal({ login: 'nurse', authorities: ['ROLE_NURSE'] }) } },
        // A stub, because what is under test is how the page reads the store, not the store.
        {
          provide: PatientsStore,
          useValue: {
            refresh: async () => undefined,
            filters: signal({ query: '', sex: null, childrenOnly: false }),
            rows: signal([]),
            total: signal(0),
            hasMore: signal(false),
            status: signal('fresh'),
            fetchedAt: signal(null),
            recencyRestricted: signal(false),
            rowsRestricted: signal(false),
            record: signal(null),
            recordLoading: signal(false),
            recordFailed: signal(false),
            recordActivityRestricted: signal(false),
            pendingForOpenRecord: pending,
          },
        },
      ],
    });
  });

  it('shows NO chip on a record with nothing pending', () => {
    // The positive control. A chip that renders unconditionally would say every note is unsent,
    // which is worse than the defect it replaces.
    const subject = page();

    expect(subject.pendingActivities()).toEqual([]);
    expect(subject.pendingReports()).toEqual([]);
  });

  it('carries an unsent activity note to the activity list', () => {
    pending.set([entry('activity', 'Wound dressed')] as never);

    expect(
      page()
        .pendingActivities()
        .map(e => e.label),
    ).toEqual(['Wound dressed']);
  });

  it('puts an unsent report under reports, not under activity', () => {
    // Two lists, two kinds. A report drawn among the activity entries is a different note than the
    // one the clinician wrote.
    pending.set([entry('activity', 'Wound dressed'), entry('report', 'Bloods')] as never);

    const subject = page();

    expect(subject.pendingActivities().map(e => e.label)).toEqual(['Wound dressed']);
    expect(subject.pendingReports().map(e => e.label)).toEqual(['Bloods']);
  });

  it('follows the queued op s state, so a rejection is visible where the note is', () => {
    pending.set([{ ...entry('activity', 'Wound dressed'), state: 'rejected' }] as never);

    expect(page().pendingActivities()[0].state).toBe('rejected');
  });
});
