import { HttpHeaders, HttpResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { CaseApiService } from '../../core/api/case-api.service';
import { DashboardApiService } from '../../core/api/dashboard-api.service';
import { CacheStore } from '../../core/offline/cache-store.service';
import { PreferencesService } from '../../core/native/preferences.service';
import { SecureTokenStore } from '../../core/native/secure-token-store.service';
import { DashboardStore } from './dashboard.store';

const disk = new Map<string, unknown>();
jest.mock('idb-keyval', () => ({
  get: jest.fn(async (key: string) => disk.get(key)),
  set: jest.fn(async (key: string, value: unknown) => void disk.set(key, value)),
  del: jest.fn(async (key: string) => void disk.delete(key)),
  keys: jest.fn(async () => [...disk.keys()]),
  clear: jest.fn(async () => disk.clear()),
}));

describe('DashboardStore', () => {
  let store: DashboardStore;
  let api: { summary: jest.Mock };
  let cases: { queue: jest.Mock };

  /** A page whose body is one row and whose header carries the real total — what size=1 returns. */
  const countPage = (total: number): HttpResponse<unknown[]> =>
    new HttpResponse({ body: [], headers: new HttpHeaders({ 'X-Total-Count': String(total) }) });

  const TOTALS: Record<string, number> = { open: 7, urgent: 2, closed: 41 };

  beforeEach(async () => {
    disk.clear();
    const preferences = new Map<string, string>();
    const secrets = new Map<string, string>();

    api = { summary: jest.fn(() => of({ patients: 12, female: 8, male: 4, kids: 3 })) };
    cases = { queue: jest.fn((_page: number, _size: number, status: string) => of(countPage(TOTALS[status]))) };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: DashboardApiService, useValue: api },
        { provide: CaseApiService, useValue: cases },
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
    await TestBed.inject(CacheStore).initialize('nurse');
    store = TestBed.inject(DashboardStore);
  });

  it('shows the patient figures the server sent', async () => {
    await store.refresh();

    expect(store.patients()).toBe(12);
    expect(store.kids()).toBe(3);
  });

  it('asks for ONE row per status and reads only the header', async () => {
    // Three tiny requests for three exact totals, rather than downloading a caseload to count it.
    // A page size of 20 here would move real clinical prose over mobile data to render a number.
    await store.refresh();

    expect(cases.queue).toHaveBeenCalledTimes(3);
    cases.queue.mock.calls.forEach(([page, size]) => {
      expect(page).toBe(0);
      expect(size).toBe(1);
    });
  });

  it('counts the whole queue, not the rows on a page', async () => {
    // The case screen counts what it loaded and is honest about that; a dashboard would not be.
    await store.refresh();

    expect(store.openCases()).toBe(7);
    expect(store.urgentCases()).toBe(2);
    expect(store.closedCases()).toBe(41);
  });

  it('renders NULL, never zero, when the case source fails', async () => {
    // The whole reason the tiles take a nullable number. "0 urgent" is a statement about a
    // caseload, and making it because a request failed is the failure this guards.
    cases.queue.mockReturnValue(throwError(() => new Error('offline')));

    await store.refresh();

    expect(store.urgentCases()).toBeNull();
    expect(store.openCases()).toBeNull();
  });

  it('treats a MISSING X-Total-Count as unknown, not as zero', async () => {
    // Without the header the count is unknowable. Reading it as zero would put a confident number
    // on screen sourced from nothing at all.
    cases.queue.mockReturnValue(of(new HttpResponse({ body: [] })));

    await store.refresh();

    expect(store.openCases()).toBeNull();
  });

  it('drops ALL case counts when one status fails, rather than showing a partial set', async () => {
    // Two numbers and a dash invites reading the two as the complete picture.
    cases.queue.mockImplementation((_page: number, _size: number, status: string) =>
      status === 'urgent' ? throwError(() => new Error('boom')) : of(countPage(TOTALS[status])),
    );

    await store.refresh();

    expect(store.openCases()).toBeNull();
    expect(store.closedCases()).toBeNull();
  });

  it('says the case figures are unavailable when only that half failed', async () => {
    cases.queue.mockReturnValue(throwError(() => new Error('offline')));

    await store.refresh();

    expect(store.patients()).toBe(12);
    expect(store.casesUnavailable()).toBe(true);
  });

  it('does not claim cases are unavailable when NOTHING loaded', async () => {
    // With no figures at all the banner already says the screen is empty; a second message about
    // cases specifically would be misleading about which half is at fault.
    api.summary.mockReturnValue(throwError(() => new Error('offline')));
    cases.queue.mockReturnValue(throwError(() => new Error('offline')));

    await store.refresh();

    expect(store.casesUnavailable()).toBe(false);
    expect(store.status()).toBe('error');
  });

  it('lets the two halves fail independently', async () => {
    // A slow patientservice must not hold up figures professionalservice can answer alone.
    api.summary.mockReturnValue(throwError(() => new Error('offline')));

    await store.refresh();

    expect(store.patients()).toBeNull();
    expect(store.openCases()).toBe(7);
  });

  it('serves the cached patient figures when the request fails, marked stale', async () => {
    await store.refresh();
    api.summary.mockReturnValue(throwError(() => new Error('offline')));

    await store.refresh();

    expect(store.patients()).toBe(12);
    expect(store.status()).toBe('stale');
  });

  it('caches the summary IN THE CLEAR — four integers, no clinical content', async () => {
    // Deliberate, and the opposite of every other cache in this app: the shell can then render it
    // before the keystore is unlocked. Asserted so a later "seal everything" sweep has to be a
    // decision rather than an accident.
    await store.refresh();

    expect(JSON.stringify(disk.get('hpd:dashboard.summary'))).toContain('12');
  });

  it('does not cache case counts, which move as a clinician works', async () => {
    await store.refresh();

    expect([...disk.keys()].filter(key => key.includes('case'))).toEqual([]);
  });
});
