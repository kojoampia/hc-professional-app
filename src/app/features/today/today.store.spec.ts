import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { DutyRosterApiService } from '../../core/api/duty-roster-api.service';
import { MessagingApiService } from '../../core/api/messaging-api.service';
import { OnboardingApiService, isWorkingClinician } from '../../core/api/onboarding-api.service';
import { PreferencesService } from '../../core/native/preferences.service';
import { CacheStore } from '../../core/offline/cache-store.service';
import { TodayStore } from './today.store';

const disk = new Map<string, unknown>();
jest.mock('idb-keyval', () => ({
  get: jest.fn(async (key: string) => disk.get(key)),
  set: jest.fn(async (key: string, value: unknown) => void disk.set(key, value)),
  del: jest.fn(async (key: string) => void disk.delete(key)),
  keys: jest.fn(async () => [...disk.keys()]),
  clear: jest.fn(async () => disk.clear()),
}));

const iso = (offsetDays: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('TodayStore', () => {
  let store: TodayStore;
  let roster: jest.Mock;
  let unread: jest.Mock;
  let documents: jest.Mock;
  let application: jest.Mock;

  const configure = async (): Promise<void> => {
    disk.clear();
    const prefs = new Map<string, string>();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: DutyRosterApiService, useValue: { myAssignments: roster } },
        { provide: MessagingApiService, useValue: { unreadCount: unread } },
        { provide: OnboardingApiService, useValue: { myDocuments: documents, myApplication: application } },
        {
          provide: PreferencesService,
          useValue: {
            get: async (key: string) => prefs.get(key) ?? null,
            set: async (key: string, value: string) => void prefs.set(key, value),
          },
        },
      ],
    });
    await TestBed.inject(CacheStore).initialize('nurse');
    store = TestBed.inject(TodayStore);
  };

  beforeEach(async () => {
    roster = jest.fn(() => of([]));
    unread = jest.fn(() => of(0));
    documents = jest.fn(() => of([]));
    application = jest.fn(() => of({ id: 'app1', accountId: 'nurse', requestedRole: 'ROLE_NURSE', status: 'ACTIVE' }));
    await configure();
  });

  const assignment = (over: Record<string, unknown>) => ({
    id: 'a1',
    date: iso(0),
    duty: 'NURSE',
    professionalId: 'p1',
    shift: 'DAY',
    name: 'Ward B',
    ...over,
  });

  it('loads every source', async () => {
    await store.refresh();
    expect(roster).toHaveBeenCalled();
    expect(unread).toHaveBeenCalled();
    expect(documents).toHaveBeenCalled();
    expect(application).toHaveBeenCalled();
  });

  it('keeps sources INDEPENDENT — one failure must not blank the others', async () => {
    unread = jest.fn(() => throwError(() => new Error('boom')));
    roster = jest.fn(() => of([assignment({})]));
    await configure();

    await store.refresh();

    expect(store.roster.value()).toHaveLength(1);
    expect(store.roster.status()).toBe('fresh');
    expect(store.unread.status()).toBe('error');
  });

  describe('the next 7 days', () => {
    it('includes today and excludes anything past the horizon', async () => {
      roster = jest.fn(() =>
        of([
          assignment({ id: 'today', date: iso(0) }),
          assignment({ id: 'soon', date: iso(6) }),
          assignment({ id: 'far', date: iso(30) }),
          assignment({ id: 'past', date: iso(-2) }),
        ]),
      );
      await configure();
      await store.refresh();

      expect(store.upcoming().map(a => a.id)).toEqual(['today', 'soon']);
    });

    it('sorts by date', async () => {
      roster = jest.fn(() => of([assignment({ id: 'later', date: iso(3) }), assignment({ id: 'sooner', date: iso(1) })]));
      await configure();
      await store.refresh();

      expect(store.upcoming().map(a => a.id)).toEqual(['sooner', 'later']);
    });
  });

  describe('expiring licences', () => {
    const doc = (over: Record<string, unknown>) => ({
      id: 'd1',
      type: 'LICENSE',
      verificationStatus: 'VERIFIED',
      ...over,
    });

    it('flags one inside the 30-day window', async () => {
      documents = jest.fn(() => of([doc({ expiryDate: iso(10) })]));
      await configure();
      await store.refresh();

      expect(store.expiringDocuments()).toHaveLength(1);
      expect(store.expiringDocuments()[0].lapsed).toBe(false);
      expect(store.expiringDocuments()[0].daysRemaining).toBeGreaterThanOrEqual(9);
    });

    it('marks an already-expired one as lapsed', async () => {
      documents = jest.fn(() => of([doc({ expiryDate: iso(-3) })]));
      await configure();
      await store.refresh();

      expect(store.expiringDocuments()[0].lapsed).toBe(true);
    });

    it('ignores one comfortably in the future', async () => {
      documents = jest.fn(() => of([doc({ expiryDate: iso(200) })]));
      await configure();
      await store.refresh();

      expect(store.expiringDocuments()).toHaveLength(0);
    });

    it('only considers LICENCES — a certificate lapsing does not cost access', async () => {
      // ComplianceService restricts an ACTIVE application when a LICENSE expires.
      documents = jest.fn(() => of([doc({ type: 'CERTIFICATE', expiryDate: iso(5) })]));
      await configure();
      await store.refresh();

      expect(store.expiringDocuments()).toHaveLength(0);
    });

    it('sorts most urgent first', async () => {
      documents = jest.fn(() => of([doc({ id: 'later', expiryDate: iso(20) }), doc({ id: 'lapsed', expiryDate: iso(-1) })]));
      await configure();
      await store.refresh();

      expect(store.expiringDocuments().map(e => e.document.id)).toEqual(['lapsed', 'later']);
    });
  });

  it('reports the OLDEST fetch across sources, so the staleness chip does not flatter', async () => {
    await store.refresh();
    expect(store.oldestFetchedAt()).toBeLessThanOrEqual(Date.now());
  });

  it('is stale when any source is stale', async () => {
    await store.refresh();
    expect(store.isStale()).toBe(false);

    roster = jest.fn(() => throwError(() => new Error('offline')));
    await configure();
    await store.roster.refresh(); // nothing cached in the fresh instance -> error
    expect(store.roster.status()).toBe('error');
  });

  describe('working-clinician gate', () => {
    it.each(['ACTIVE', 'ROSTER_CONFIGURED'])('%s is a working clinician', status => {
      expect(isWorkingClinician(status as never)).toBe(true);
    });

    it.each(['APPLICATION_STARTED', 'CREDENTIAL_REVIEW', 'APPROVED', 'SUSPENDED', 'REJECTED', 'EXPIRED'])(
      '%s is not, and gets sent to the web portal',
      status => {
        expect(isWorkingClinician(status as never)).toBe(false);
      },
    );

    it('treats an unknown status as not working', () => {
      expect(isWorkingClinician(null)).toBe(false);
      expect(isWorkingClinician(undefined)).toBe(false);
    });
  });
});
