import { HttpHeaders, HttpResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';

import { CaseApiService, CaseDetailDto, CaseSummaryDto } from '../../core/api/case-api.service';
import { CacheStore } from '../../core/offline/cache-store.service';
import { PreferencesService } from '../../core/native/preferences.service';
import { SecureTokenStore } from '../../core/native/secure-token-store.service';
import { WriteQueue } from '../../core/offline/write-queue.service';
import { CasesStore, PAGE_SIZE } from './cases.store';

/** The queue's own list, so a spec can watch an op appear rather than trusting a call count. */
const queueWrites = signal<any[]>([]);

const disk = new Map<string, unknown>();
jest.mock('idb-keyval', () => ({
  get: jest.fn(async (key: string) => disk.get(key)),
  set: jest.fn(async (key: string, value: unknown) => void disk.set(key, value)),
  del: jest.fn(async (key: string) => void disk.delete(key)),
  keys: jest.fn(async () => [...disk.keys()]),
  clear: jest.fn(async () => disk.clear()),
}));

describe('CasesStore', () => {
  let store: CasesStore;
  let api: { queue: jest.Mock; detail: jest.Mock; update: jest.Mock };
  let queue: { submit: jest.Mock; register: jest.Mock; writes: typeof queueWrites };

  const row = (id: string, over: Partial<CaseSummaryDto> = {}): CaseSummaryDto => ({
    id,
    patientId: over.patientId ?? `patient-of-${id}`,
    openedAt: over.openedAt ?? '2026-08-20T09:00:00Z',
    brief: over.brief ?? `Brief ${id}`,
    status: over.status ?? 'open',
  });

  const detail = (id: string, over: Partial<CaseDetailDto> = {}): CaseDetailDto => ({
    ...row(id),
    caseNumber: 7,
    title: 'A case',
    closedAt: null,
    symptoms: over.symptoms ?? 'Cough',
    diagnosis: over.diagnosis ?? 'Bronchitis',
    ...over,
  });

  const page = (rows: CaseSummaryDto[], total = rows.length): HttpResponse<CaseSummaryDto[]> =>
    new HttpResponse({ body: rows, headers: new HttpHeaders({ 'X-Total-Count': String(total) }) });

  beforeEach(async () => {
    disk.clear();
    const preferences = new Map<string, string>();
    const secrets = new Map<string, string>();

    api = {
      queue: jest.fn(() => of(page([row('c1'), row('c2', { status: 'urgent' })]))),
      // Echoes the patient it was asked for, as the server does. A stub returning a fixed one
      // would let the store carry the wrong patient into the edit path and still look green.
      detail: jest.fn((patientId: string, caseId: string) => of(detail(caseId, { patientId }))),
      update: jest.fn(() => of(row('c1'))),
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
        { provide: CaseApiService, useValue: api },
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
    store = TestBed.inject(CasesStore);
  });

  it('asks for one page, not the whole queue', async () => {
    await store.refresh();

    expect(api.queue).toHaveBeenCalledWith(0, PAGE_SIZE, undefined);
  });

  it('asks for page zero exactly once per refresh', async () => {
    // Same trap the patient directory had: a second page-zero read to fill the offline copy is the
    // waste paging exists to avoid. The cache is written from the response already in hand.
    await store.refresh();

    expect(api.queue.mock.calls.filter(([page]) => page === 0)).toHaveLength(1);
  });

  it('sends the status filter to the SERVER, not to the browser', async () => {
    // Filtering a page of twenty locally would narrow a set the server had already paged, so the
    // count would silently disagree with X-Total-Count and "load more" would fetch the wrong rows.
    await store.filterByStatus('urgent');

    expect(api.queue).toHaveBeenLastCalledWith(0, PAGE_SIZE, 'urgent');
  });

  it('serves the cached first page when the request fails, marked stale', async () => {
    await store.refresh();
    api.queue.mockReturnValue(throwError(() => new Error('offline')));

    await store.refresh();

    expect(store.rows()).toHaveLength(2);
    expect(store.status()).toBe('stale');
  });

  it('does NOT cache a filtered page — the cache is the unfiltered queue', async () => {
    // Otherwise the offline copy is whatever filter happened to be active last, which is not
    // something a clinician chose and not something the screen can tell them.
    await store.filterByStatus('closed');
    api.queue.mockReturnValue(throwError(() => new Error('offline')));

    await store.filterByStatus('closed');

    expect(store.rows()).toHaveLength(0);
    expect(store.status()).toBe('error');
  });

  it('counts null rather than zero when nothing could be loaded', async () => {
    // "0 urgent" is a claim about a caseload. A tile making it because a request failed is worse
    // than a tile admitting it does not know.
    api.queue.mockReturnValue(throwError(() => new Error('offline')));

    await store.refresh();

    expect(store.urgentCount()).toBeNull();
    expect(store.openCount()).toBeNull();
  });

  it('counts the rows it has once they load', async () => {
    await store.refresh();

    expect(store.openCount()).toBe(1);
    expect(store.urgentCount()).toBe(1);
    expect(store.closedCount()).toBe(0);
  });

  it('fetches the full case on open — the row carries no symptoms or diagnosis', async () => {
    await store.refresh();

    await store.openCaseById(row('c1', { patientId: 'p9' }));

    expect(api.detail).toHaveBeenCalledWith('p9', 'c1');
    expect(store.openCase()?.diagnosis).toBe('Bronchitis');
  });

  it('reports a failed open rather than showing an empty case', async () => {
    api.detail.mockReturnValue(throwError(() => new Error('404')));

    await store.openCaseById(row('c1'));

    expect(store.openFailed()).toBe(true);
    expect(store.openCase()).toBeNull();
  });

  it('queues an edit instead of calling the API directly', async () => {
    // This is the architecture, so it gets an assertion: a mutation that reaches HttpClient while
    // offline fails loudly by design, and the queue is the only path that survives no signal.
    await store.refresh();
    await store.openCaseById(row('c1', { patientId: 'p9' }));

    await store.edit({ diagnosis: 'Pneumonia' });

    expect(api.update).not.toHaveBeenCalled();
    expect(queue.submit).toHaveBeenCalledWith('case.patch', 'c1', { patientId: 'p9', changes: { diagnosis: 'Pneumonia' } });
  });

  it('shows the clinician their own words at once, marked unsent', async () => {
    await store.refresh();
    await store.openCaseById(row('c1'));

    await store.edit({ diagnosis: 'Pneumonia' });

    expect(store.openCase()?.diagnosis).toBe('Pneumonia');
    expect(store.pendingEditFor()?.state).toBe('pending');
  });

  it('never writes an unsent edit to the cache', async () => {
    // The cache is what the server said. A restart must not resurrect an edit that never landed —
    // it would read as filed, by the clinician who typed it and by whoever opens the case next.
    await store.refresh();
    await store.openCaseById(row('c1'));
    await store.edit({ brief: 'Edited offline' });

    api.queue.mockReturnValue(throwError(() => new Error('offline')));
    await store.refresh();

    expect(store.rows().find(r => r.id === 'c1')?.brief).toBe('Brief c1');
  });

  it('registers its op kind with the queue so a drain after a restart can send it', async () => {
    expect(queue.register).toHaveBeenCalledWith('case.patch', expect.any(Function));
  });

  it('sends a queued edit through the API with the patient from the payload', async () => {
    const sender = queue.register.mock.calls.find(([kind]) => kind === 'case.patch')?.[1];

    await sender({ subjectId: 'c1', payload: { patientId: 'p9', changes: { brief: 'x' } } });

    expect(api.update).toHaveBeenCalledWith('p9', 'c1', { brief: 'x' });
  });
});
