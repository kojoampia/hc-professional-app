import { HttpHeaders, HttpResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';

import { PatientApiService, PatientListItemDto } from '../../core/api/patient-api.service';
import { CacheStore } from '../../core/offline/cache-store.service';
import { PreferencesService } from '../../core/native/preferences.service';
import { SecureTokenStore } from '../../core/native/secure-token-store.service';
import { WriteQueue } from '../../core/offline/write-queue.service';
import { PAGE_SIZE, PatientsStore, RECORD_CACHE_LIMIT } from './patients.store';

/** The queue's own list, so a spec can move an op's state and watch the record follow. */
const queueWrites = signal<any[]>([]);

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
  let api: { query: jest.Mock; find: jest.Mock; appendActivity: jest.Mock; appendReport: jest.Mock };
  let queue: { submit: jest.Mock; register: jest.Mock; writes: typeof queueWrites };

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

    api = {
      query: jest.fn(() => of(page([row('p1'), row('p2')]))),
      find: jest.fn(() => of({ id: 'p1', patientName: 'Ama' })),
      appendActivity: jest.fn(() => of({ id: 'a1' })),
      appendReport: jest.fn(() => of({ id: 'r1' })),
    };
    queueWrites.set([]);
    let nextId = 0;
    queue = {
      register: jest.fn(),
      writes: queueWrites,
      submit: jest.fn(async (kind: string, subjectId: string, payload: unknown) => {
        const write = { id: `w${++nextId}`, kind, subjectId, payload, state: 'pending', clientRef: `ref-${nextId}` };
        queueWrites.update(existing => [...existing, write]);
        return write;
      }),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: PatientApiService, useValue: api },
        { provide: WriteQueue, useValue: queue },
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

  describe('filing (Phase 6)', () => {
    it('goes through the QUEUE, never straight to the API', async () => {
      // The whole architecture: a mutation reaching HttpClient directly still fails loudly offline.
      await store.fileActivity('p1', { title: 'Wound dressed', description: 'No exudate' });

      expect(queue.submit).toHaveBeenCalledWith('activity.append', 'p1', expect.objectContaining({ title: 'Wound dressed' }));
      expect(api.appendActivity).not.toHaveBeenCalled();
    });

    it('registers a sender for each kind it can queue', () => {
      // The queue owns WHEN; the store owns HOW. Without this the op sits pending forever.
      expect(queue.register).toHaveBeenCalledWith('activity.append', expect.any(Function));
      expect(queue.register).toHaveBeenCalledWith('report.append', expect.any(Function));
    });

    it('sends the clientRef the server keys its receipts on', async () => {
      const sender = queue.register.mock.calls.find(([kind]) => kind === 'activity.append')?.[1];
      await sender({ subjectId: 'p1', clientRef: 'ref-1', payload: { title: 't', description: 'd' } });

      expect(api.appendActivity).toHaveBeenCalledWith('p1', expect.objectContaining({ clientRef: 'ref-1' }));
    });

    it('shows the entry immediately, MARKED rather than merged', async () => {
      api.find.mockReturnValue(of({ id: 'p1', patientName: 'Ama', activities: [], reports: [], cases: [] }));
      await store.openRecord('p1');

      await store.fileActivity('p1', { title: 'Wound dressed', description: 'd' });

      expect(store.pendingForOpenRecord()).toHaveLength(1);
      expect(store.pendingForOpenRecord()[0].label).toBe('Wound dressed');
    });

    it('does not show another patient s unsent entries', async () => {
      api.find.mockReturnValue(of({ id: 'p1', patientName: 'Ama', activities: [], reports: [], cases: [] }));
      await store.openRecord('p1');

      await store.fileActivity('p2', { title: 'Someone else', description: 'd' });

      expect(store.pendingForOpenRecord()).toHaveLength(0);
    });

    it('DROPS the optimistic entry once the op leaves the queue', async () => {
      // It has landed; the next read shows the server's own copy. Leaving it would double the row.
      api.find.mockReturnValue(of({ id: 'p1', patientName: 'Ama', activities: [], reports: [], cases: [] }));
      await store.openRecord('p1');
      await store.fileActivity('p1', { title: 'Wound dressed', description: 'd' });

      queueWrites.set([]);

      expect(store.pendingForOpenRecord()).toHaveLength(0);
    });

    it('reflects the queued op s state, so a conflict is visible on the record', async () => {
      api.find.mockReturnValue(of({ id: 'p1', patientName: 'Ama', activities: [], reports: [], cases: [] }));
      await store.openRecord('p1');
      await store.fileActivity('p1', { title: 'Wound dressed', description: 'd' });

      queueWrites.update(writes => writes.map(write => ({ ...write, state: 'rejected' })));

      expect(store.pendingForOpenRecord()[0].state).toBe('rejected');
    });
  });
});
