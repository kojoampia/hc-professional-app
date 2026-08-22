import { HttpHeaders, HttpResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { PatientApiService, PatientListItemDto } from '../../core/api/patient-api.service';
import { CacheStore } from '../../core/offline/cache-store.service';
import { PreferencesService } from '../../core/native/preferences.service';
import { SecureTokenStore } from '../../core/native/secure-token-store.service';
import { PAGE_SIZE, PatientsStore, RECORD_CACHE_LIMIT } from './patients.store';

const disk = new Map<string, unknown>();
jest.mock('idb-keyval', () => ({
  get: jest.fn(async (key: string) => disk.get(key)),
  set: jest.fn(async (key: string, value: unknown) => void disk.set(key, value)),
  del: jest.fn(async (key: string) => void disk.delete(key)),
  keys: jest.fn(async () => [...disk.keys()]),
  clear: jest.fn(async () => disk.clear()),
}));

describe('PatientsStore', () => {
  let store: PatientsStore;
  let api: { query: jest.Mock; find: jest.Mock };

  const row = (id: string, over: Partial<PatientListItemDto> = {}): PatientListItemDto => ({
    id,
    patientName: over.patientName ?? `Patient ${id}`,
    lastActivityAt: over.lastActivityAt ?? '2026-08-20T09:00:00Z',
    sex: over.sex ?? 'female',
    isChild: over.isChild ?? false,
  });

  /** A page response with the header the server really sends. */
  const page = (rows: PatientListItemDto[], total = rows.length): HttpResponse<PatientListItemDto[]> =>
    new HttpResponse({ body: rows, headers: new HttpHeaders({ 'X-Total-Count': String(total) }) });

  beforeEach(async () => {
    disk.clear();
    const preferences = new Map<string, string>();
    const secrets = new Map<string, string>();

    api = { query: jest.fn(() => of(page([row('p1'), row('p2')]))), find: jest.fn(() => of({ id: 'p1', patientName: 'Ama' })) };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: PatientApiService, useValue: api },
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
    store = TestBed.inject(PatientsStore);
  });

  it('asks for one page, not the whole caseload', async () => {
    await store.refresh();

    expect(api.query).toHaveBeenCalledWith(expect.objectContaining({ page: 0, size: PAGE_SIZE }));
  });

  it('asks for page zero exactly ONCE per refresh', async () => {
    // It asked twice at first — once for the list and once to fill the offline copy — which is the
    // waste paging exists to avoid. Page zero is cached from the response already in hand.
    await store.refresh();

    expect(api.query.mock.calls.filter(([request]) => request.page === 0)).toHaveLength(1);
  });

  it('serves the cached page before the request lands, so the list is never blank', async () => {
    await store.refresh();
    api.query.mockReturnValue(throwError(() => new Error('offline')));

    await store.refresh();

    expect(store.rows().map(r => r.id)).toEqual(['p1', 'p2']);
    expect(store.status()).toBe('stale');
  });

  it('reads the total from X-Total-Count so it knows there is more', async () => {
    api.query.mockReturnValue(of(page([row('p1'), row('p2')], 57)));

    await store.refresh();

    expect(store.total()).toBe(57);
    expect(store.hasMore()).toBe(true);
  });

  it('treats a MISSING total as "this is everything", not as zero', async () => {
    // Zero would empty a list the server had just filled.
    api.query.mockReturnValue(of(new HttpResponse({ body: [row('p1')] })));

    await store.refresh();

    expect(store.total()).toBe(1);
    expect(store.hasMore()).toBe(false);
  });

  it('APPENDS the next page rather than replacing what is on screen', async () => {
    api.query.mockReturnValueOnce(of(page([row('p1')], 2))).mockReturnValueOnce(of(page([row('p2')], 2)));
    await store.refresh();

    await store.loadMore();

    expect(store.rows().map(r => r.id)).toEqual(['p1', 'p2']);
    expect(store.hasMore()).toBe(false);
  });

  it('asks for page 1 second, not page 0 again', async () => {
    await store.refresh();
    api.query.mockClear();

    await store.loadMore();

    expect(api.query).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }));
  });

  it('LEAVES what is already listed alone when a later page fails', async () => {
    // A directory that empties itself because page three did not arrive is worse than one that
    // simply stops growing.
    api.query.mockReturnValueOnce(of(page([row('p1')], 99)));
    await store.refresh();
    api.query.mockReturnValue(throwError(() => new Error('offline')));

    await store.loadMore();

    expect(store.rows().map(r => r.id)).toEqual(['p1']);
    expect(store.failed()).toBe(true);
  });

  it('reports error only when there is nothing at all to show', async () => {
    api.query.mockReturnValue(throwError(() => new Error('offline')));

    await store.refresh();

    expect(store.status()).toBe('error');
  });

  describe('filters go to the server, not the browser', () => {
    it('sends the search text', async () => {
      await store.applyFilters({ query: 'mensah' });

      expect(api.query).toHaveBeenCalledWith(expect.objectContaining({ query: 'mensah', page: 0 }));
    });

    it('sends sex and childrenOnly', async () => {
      await store.applyFilters({ sex: 'male', childrenOnly: true });

      expect(api.query).toHaveBeenCalledWith(expect.objectContaining({ sex: 'male', childrenOnly: true }));
    });

    it('starts again from page zero when a filter changes', async () => {
      await store.refresh();
      await store.loadMore();

      await store.applyFilters({ query: 'ama' });

      expect(api.query).toHaveBeenLastCalledWith(expect.objectContaining({ page: 0, query: 'ama' }));
      expect(store.rows()).toHaveLength(2);
    });

    it('does NOT cache a filtered first page', async () => {
      // What is cached is the caseload as it stands, not the result of whatever someone last typed
      // — a cached search result goes stale in a way nobody can reason about.
      await store.applyFilters({ query: 'mensah' });

      expect(disk.has('hpd:patients.firstPage')).toBe(false);
    });

    it('caches the unfiltered first page', async () => {
      await store.refresh();

      expect(disk.has('hpd:patients.firstPage')).toBe(true);
    });
  });

  describe('records', () => {
    it('shows the cached copy first so the screen is never blank', async () => {
      await store.openRecord('p1');
      api.find.mockReturnValue(throwError(() => new Error('offline')));

      await store.openRecord('p1');

      expect(store.record()).toMatchObject({ id: 'p1' });
      expect(store.recordFailed()).toBe(false);
    });

    it('reports a failure only when there is no cached copy', async () => {
      api.find.mockReturnValue(throwError(() => new Error('offline')));

      await store.openRecord('never-opened');

      expect(store.recordFailed()).toBe(true);
    });

    it('SEALS a record — no clinical text is readable on disk', async () => {
      api.find.mockReturnValue(of({ id: 'p1', patientName: 'Ama Mensah', diagnosisNote: 'suspected sepsis' }));

      await store.openRecord('p1');

      expect(JSON.stringify(disk.get('hpd:patients.record.p1'))).not.toContain('sepsis');
    });

    it('BOUNDS the cached records, so a long career cannot fill the sandbox', async () => {
      for (let i = 0; i <= RECORD_CACHE_LIMIT; i++) {
        api.find.mockReturnValue(of({ id: `p${i}`, patientName: `Patient ${i}` }));
        await store.openRecord(`p${i}`);
      }

      const cachedRecords = [...disk.keys()].filter(key => key.startsWith('hpd:patients.record.'));
      expect(cachedRecords).toHaveLength(RECORD_CACHE_LIMIT);
      // The oldest went, not the newest.
      expect(cachedRecords).not.toContain('hpd:patients.record.p0');
    });

    it('clears the open record on close', async () => {
      await store.openRecord('p1');

      store.closeRecord();

      expect(store.record()).toBeNull();
    });
  });
});
