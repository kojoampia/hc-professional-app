import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { AbsenceApiService } from '../../core/api/absence-api.service';
import { DutyRosterApiService } from '../../core/api/duty-roster-api.service';
import { CacheStore } from '../../core/offline/cache-store.service';
import { PreferencesService } from '../../core/native/preferences.service';
import { SecureTokenStore } from '../../core/native/secure-token-store.service';
import { RosterStore, datesBetween } from './roster.store';

// jsdom has no IndexedDB and the store caches through idb-keyval. Same in-memory stand-in the other
// store specs use; the cache is not what these assert.
const disk = new Map<string, unknown>();
jest.mock('idb-keyval', () => ({
  get: jest.fn(async (key: string) => disk.get(key)),
  set: jest.fn(async (key: string, value: unknown) => void disk.set(key, value)),
  del: jest.fn(async (key: string) => void disk.delete(key)),
  keys: jest.fn(async () => [...disk.keys()]),
  clear: jest.fn(async () => disk.clear()),
}));

describe('RosterStore', () => {
  let store: RosterStore;
  let rosterApi: { summary: jest.Mock; day: jest.Mock; myAssignments: jest.Mock; range: jest.Mock };
  let absenceApi: { mine: jest.Mock; request: jest.Mock; withdraw: jest.Mock };

  const summaryRow = (date: string, over: Partial<{ shifts: string[]; visits: number; absence: unknown }> = {}) => ({
    date,
    shifts: over.shifts ?? ['DAY'],
    visits: over.visits ?? 2,
    absence: over.absence ?? null,
  });

  beforeEach(async () => {
    disk.clear();
    rosterApi = {
      summary: jest.fn(() => of([summaryRow('2026-08-20'), summaryRow('2026-08-21')])),
      day: jest.fn(() => of([])),
      myAssignments: jest.fn(() => of([])),
      range: jest.fn(() => of([])),
    };
    absenceApi = {
      mine: jest.fn(() => of([])),
      request: jest.fn(() => of({})),
      withdraw: jest.fn(() => of(undefined)),
    };

    const preferences = new Map<string, string>();
    TestBed.configureTestingModule({
      providers: [
        { provide: DutyRosterApiService, useValue: rosterApi },
        { provide: AbsenceApiService, useValue: absenceApi },
        {
          provide: PreferencesService,
          useValue: {
            get: async (k: string) => preferences.get(k) ?? null,
            set: async (k: string, v: string) => void preferences.set(k, v),
            remove: async (k: string) => void preferences.delete(k),
          },
        },
        { provide: SecureTokenStore, useValue: { readSecret: async () => null, writeSecret: async () => undefined } },
      ],
    });
    await TestBed.inject(CacheStore).initialize('nurse');
    store = TestBed.inject(RosterStore);
  });

  it('marks the days that carry a shift', async () => {
    await store.refresh();

    expect(store.workedDates()).toEqual(['2026-08-20', '2026-08-21']);
  });

  it('does not mark a day that has a summary row but no shift', async () => {
    rosterApi.summary.mockReturnValue(of([summaryRow('2026-08-20', { shifts: [] })]));

    await store.refresh();

    expect(store.workedDates()).toEqual([]);
  });

  it('EXPANDS an absence across every day it covers', async () => {
    // The calendar marks days, the server stores ranges. A three-day holiday that marks only its
    // first day is the kind of thing nobody notices until someone is rostered mid-leave.
    absenceApi.mine.mockReturnValue(of([{ id: 'a1', fromDate: '2026-08-20', toDate: '2026-08-22', type: 'HOLIDAY', status: 'APPROVED' }]));

    await store.refresh();

    expect(store.absentDates()).toEqual(['2026-08-20', '2026-08-21', '2026-08-22']);
  });

  it('keeps a day that is BOTH rostered and on leave in both sets', async () => {
    // Neither suppresses the other: leave asked for over a shift that has not been reassigned is
    // exactly the conflict the server's 409 refuses to approve.
    absenceApi.mine.mockReturnValue(of([{ id: 'a1', fromDate: '2026-08-20', toDate: '2026-08-20', type: 'SICK', status: 'REQUESTED' }]));

    await store.refresh();

    expect(store.workedDates()).toContain('2026-08-20');
    expect(store.absentDates()).toContain('2026-08-20');
  });

  it('lists only leave that has not finished, soonest first', async () => {
    const today = new Date().toISOString().slice(0, 10);
    absenceApi.mine.mockReturnValue(
      of([
        { id: 'past', fromDate: '2020-01-01', toDate: '2020-01-02', type: 'HOLIDAY', status: 'APPROVED' },
        { id: 'later', fromDate: '2999-06-01', toDate: '2999-06-02', type: 'HOLIDAY', status: 'REQUESTED' },
        { id: 'soon', fromDate: today, toDate: today, type: 'SICK', status: 'APPROVED' },
      ]),
    );

    await store.refresh();

    expect(store.upcomingAbsences().map(a => a.id)).toEqual(['soon', 'later']);
  });

  it('fetches a day EVERY time it is opened, and never caches it', async () => {
    // GET /duty-roster/day/{date} refreshes visit snapshots as it reads — it is the one roster
    // endpoint excluded from the server's ETag filter. Serving a cached copy skips the write.
    await store.openDay('2026-08-20');
    await store.openDay('2026-08-20');

    expect(rosterApi.day).toHaveBeenCalledTimes(2);
    expect(rosterApi.day).toHaveBeenCalledWith('2026-08-20');
  });

  it('reports a failed day rather than showing something stale', async () => {
    rosterApi.day.mockReturnValue(throwError(() => new Error('offline')));

    await store.openDay('2026-08-20');

    expect(store.dayFailed()).toBe(true);
    expect(store.day()).toEqual([]);
  });

  it('clears the open day on close', async () => {
    await store.openDay('2026-08-20');
    store.closeDay();

    expect(store.selectedDate()).toBeNull();
    expect(store.day()).toEqual([]);
  });

  it('re-reads leave after requesting it, rather than inserting optimistically', async () => {
    // An absence that appears and then vanishes because the server refused it is worse than one
    // that takes a moment to appear.
    await store.requestAbsence({ fromDate: '2026-09-01', toDate: '2026-09-03', type: 'HOLIDAY' });

    expect(absenceApi.request).toHaveBeenCalledWith({ fromDate: '2026-09-01', toDate: '2026-09-03', type: 'HOLIDAY' });
    expect(absenceApi.mine).toHaveBeenCalled();
  });

  it('re-reads leave after withdrawing it', async () => {
    await store.withdrawAbsence('a1');

    expect(absenceApi.withdraw).toHaveBeenCalledWith('a1');
    expect(absenceApi.mine).toHaveBeenCalled();
  });

  it('reloads the summary when the year changes', async () => {
    await store.showYear(2027);

    expect(store.year()).toBe(2027);
    expect(rosterApi.summary).toHaveBeenCalled();
  });

  it('SERVES CACHED marks when the fetch fails, and says it is stale', async () => {
    await store.refresh();
    rosterApi.summary.mockReturnValue(throwError(() => new Error('offline')));

    await store.refresh();

    expect(store.workedDates()).toEqual(['2026-08-20', '2026-08-21']);
    expect(store.isStale()).toBe(true);
  });
});

describe('datesBetween', () => {
  it('includes both ends', () => {
    expect(datesBetween('2026-08-20', '2026-08-22')).toEqual(['2026-08-20', '2026-08-21', '2026-08-22']);
  });

  it('handles a single day', () => {
    expect(datesBetween('2026-08-20', '2026-08-20')).toEqual(['2026-08-20']);
  });

  it('crosses a month boundary', () => {
    expect(datesBetween('2026-08-30', '2026-09-01')).toEqual(['2026-08-30', '2026-08-31', '2026-09-01']);
  });

  it('crosses a DST transition without repeating or skipping a date', () => {
    // Stepped at midday for this reason; at midnight a spring-forward can land twice on one date.
    expect(datesBetween('2026-03-28', '2026-03-30')).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
  });

  it('is empty when the range is inverted', () => {
    expect(datesBetween('2026-08-22', '2026-08-20')).toEqual([]);
  });
});
