import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { PatientApiService, PatientListItemDto, PatientRecordDto } from '../../core/api/patient-api.service';
import {
  RESTRICTED_FOLLOW_UPS_HEADER,
  RESTRICTED_PARTS_HEADER,
  RestrictedFollowUp,
  RestrictedPart,
  parseRestrictedFollowUps,
  parseRestrictedParts,
} from '../../core/api/restricted-parts';
import { CacheStore } from '../../core/offline/cache-store.service';
import { QueuedWrite } from '../../core/offline/queued-write.model';
import { WriteQueue } from '../../core/offline/write-queue.service';
import { ResourceStatus } from '../../core/offline/cached-resource';

/** Where the offline copy of page zero lives. */
const FIRST_PAGE_KEY = 'patients.firstPage';

/**
 * Where the parts withheld from the cached page live.
 *
 * <p>Cached beside the rows rather than inside them, and <b>not</b> sealed: this names a capability
 * of the signed-in role, not a patient. Without it a pharmacist's cached directory renders every
 * row as "no activity recorded" on a cold start with no signal — the exact conflation item 114
 * exists to remove, surviving in the one state this app is built around.
 */
const RESTRICTED_PARTS_KEY = 'patients.restrictedParts';

/**
 * Where the parts withheld from the <b>record</b> read live.
 *
 * <p>Kept apart from {@link RESTRICTED_PARTS_KEY} because they answer two different reads: the
 * directory composes three collections and the record composes five, and the server may withhold on
 * one and not the other. Sharing a key would let a directory answer speak for a record it never
 * described.
 *
 * <p><b>Not under the `patients.record.` prefix</b>, deliberately. {@link RECORD_CACHE_LIMIT}'s
 * eviction counts every key with that prefix as a cached record, so a marker stored there would be
 * counted toward the bound and eventually evicted as though it were a patient.
 */
const RECORD_RESTRICTED_PARTS_KEY = 'patients.recordRestrictedParts';

/**
 * Where the directory's refused <b>follow-ups</b> live.
 *
 * <p>A third key rather than a field on either of the two above, because it answers a third
 * question: not <i>what is missing from this answer</i> but <i>what will happen if you act on it</i>.
 * Cached for the same reason as the others and in the clear for the same reason — it names a
 * capability of the signed-in role, not anything about a patient — and cached at all because this
 * app is built around cold starts: without it, a technician opening the saved directory in a
 * basement is offered a hundred rows again with nothing to say they are closed.
 */
const RESTRICTED_FOLLOW_UPS_KEY = 'patients.restrictedFollowUps';

/** Rows per request. Twenty fills a phone screen twice over and costs little on mobile data. */
export const PAGE_SIZE = 20;

/** A caseload changes when an administrator assigns work — rarely, and never on the minute. */
const DIRECTORY_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * How many opened records are kept.
 *
 * <p>Bounded on purpose. Every one is clinical content sealed at rest, and an unbounded set means a
 * long career quietly fills the app sandbox with patient records — a privacy cost that grows with
 * use and that nobody would ever notice.
 */
export const RECORD_CACHE_LIMIT = 20;

/** An entry a clinician has written that has not reached the server yet. */
export interface PendingEntry {
  write: QueuedWrite;
  patientId: string;
  kind: 'activity' | 'report';
  label: string;
}

/** Filters the directory offers, matching the two the web dashboard has. */
export interface PatientFilters {
  query: string;
  sex: string | null;
  childrenOnly: boolean;
}

/**
 * The clinician's patient directory and the records they have opened.
 *
 * <h3>Page 1 is cached; pages 2+ are not</h3>
 * `cachedResource`'s contract is whole-collection replace — every fetch returns the complete list,
 * so there is nothing to merge. Paged data breaks that, and rather than bend the primitive this
 * store caches the **first page only** and treats the rest as online-only.
 *
 * <p>That is not a compromise so much as a reading of what offline is actually for here. Nobody
 * needs page seven of a patient list in a basement. What they need is *the patients they have
 * opened*, and those are cached individually and sealed — see {@link openRecord}.
 *
 * <h3>Filtering is server-side</h3>
 * Unlike `web/`, which loads the caseload eagerly and filters in the browser. A phone cannot afford
 * that, and the endpoint learned `query`, `sex` and `childrenOnly` in Phase 1.1 precisely so it
 * would not have to.
 */
@Injectable({ providedIn: 'root' })
export class PatientsStore {
  private readonly api = inject(PatientApiService);
  private readonly cache = inject(CacheStore);
  private readonly queue = inject(WriteQueue);

  private readonly filtersSignal = signal<PatientFilters>({ query: '', sex: null, childrenOnly: false });
  readonly filters = this.filtersSignal.asReadonly();

  /**
   * When the cached first page was written, for the staleness banner.
   *
   * <p>The cache is managed by hand here rather than through `cachedResource`, and the reason is
   * worth stating: that helper owns its own fetch, so pairing it with a paged list meant asking the
   * server for page zero <b>twice</b> on every refresh — once for the list, once for the cache. On
   * mobile data that is precisely the waste Phase 1.1's paging exists to avoid. Page zero is now
   * written into the cache from the response already in hand.
   */
  private readonly cachedAtSignal = signal<number | null>(null);

  private readonly rowsSignal = signal<readonly PatientListItemDto[]>([]);
  readonly rows = computed(() => this.rowsSignal());

  private readonly totalSignal = signal(0);
  readonly total = this.totalSignal.asReadonly();

  private readonly loadingSignal = signal(false);
  readonly loading = this.loadingSignal.asReadonly();

  private readonly failedSignal = signal(false);
  readonly failed = this.failedSignal.asReadonly();

  /**
   * What the server could not read on this clinician's behalf.
   *
   * <p>A fact about the <b>read</b>, not about any row — which is why it is a signal here and not a
   * field on `PatientListItemDto`. Item 111's Decision A rejected a per-row field on exactly this
   * ground: a technician is refused the case collection outright, so what they lose is not a column
   * but patients, and no per-row field can describe a row that is not in the list.
   */
  private readonly restrictedSignal = signal<readonly RestrictedPart[]>([]);
  readonly restricted = this.restrictedSignal.asReadonly();

  /**
   * The recency column could not be read, so every row's `lastActivityAt` is null for a reason.
   *
   * <p>Distinct from {@link rowsRestricted} on purpose. This blanks a field; that removes people.
   * Rendering one sentence for both would repeat item 107's defect one layer out.
   */
  readonly recencyRestricted = computed(() => this.restrictedSignal().includes('lastActivity'));

  /** Case assignments were refused, so the directory is short of patients — not merely of detail. */
  readonly rowsRestricted = computed(() => this.restrictedSignal().includes('caseAssignments'));

  /**
   * What the server says this read cannot be followed up on.
   *
   * <p>Distinct from {@link restricted} and not derivable from it. That names parts missing from
   * <b>this</b> answer; this names a read that is <b>not</b> this answer and will refuse —
   * `GET /api/patients/{id}`, which reads strictly where the directory degrades. The directory is
   * the only surface that can say it before the clinician finds out by tapping, which is the whole
   * of `../docs/backlog.md` item 132.
   */
  private readonly followUpsSignal = signal<readonly RestrictedFollowUp[]>([]);
  readonly restrictedFollowUps = this.followUpsSignal.asReadonly();

  /**
   * Every row on screen leads to a record this clinician may not open.
   *
   * <p><b>The row count is part of the question, not a detail of the template.</b> Item 128 emits
   * the marker on a zero-row page deliberately — suppressing it there would make the wire value
   * depend on caseload, and this store caches it beside page zero, so it would appear and vanish as
   * shifts were assigned. The rule handed to the clients is to key the sentence on having rows to
   * describe, and it is held here rather than in the template so a second reader of this signal
   * cannot reintroduce a banner over an empty list.
   *
   * <p>An empty-and-restricted page is not silent: it still carries `X-Restricted-Parts`' own
   * sentences, which are about the answer rather than about a tap.
   *
   * <p>Sufficient rather than complete, by item 128's own account: present, the marker is never
   * wrong; absent, a record could still refuse over a collection the directory never reads. So this
   * suppresses a tap it knows will fail and never claims a record <i>will</i> open.
   */
  readonly rowsUnopenable = computed(() => this.followUpsSignal().includes('record') && this.rowsSignal().length > 0);

  private nextPage = 0;

  /** Whether another page exists. Drives the infinite scroll's own disabled state. */
  readonly hasMore = computed(() => this.rowsSignal().length < this.totalSignal());

  /** What the shared empty row and banner read. */
  readonly status = computed<ResourceStatus>(() => {
    if (this.rowsSignal().length === 0) {
      return this.failedSignal() ? 'error' : 'fresh';
    }
    if (this.failedSignal()) {
      // Rows on screen from cache, and the network said no: that is exactly "stale".
      return 'stale';
    }
    const cachedAt = this.cachedAtSignal();
    return cachedAt !== null && Date.now() - cachedAt > DIRECTORY_TTL_MS ? 'stale' : 'fresh';
  });

  readonly fetchedAt = this.cachedAtSignal.asReadonly();

  /** The record currently open, if any. */
  private readonly recordSignal = signal<PatientRecordDto | null>(null);
  readonly record = this.recordSignal.asReadonly();

  private readonly recordLoadingSignal = signal(false);
  readonly recordLoading = this.recordLoadingSignal.asReadonly();

  private readonly recordFailedSignal = signal(false);
  readonly recordFailed = this.recordFailedSignal.asReadonly();

  /**
   * What the server could not read while composing the record currently open.
   *
   * <p>Private, and exposed only through {@link recordActivityRestricted}: the screen asks per
   * <b>known</b> part rather than looping the wire tokens, so a part named by a later release of
   * `api/` reaches neither a template nor a missing translation key.
   */
  private readonly recordRestrictedSignal = signal<readonly RestrictedPart[]>([]);

  /**
   * The activity log could not be read, so this record's `activities` is empty for a reason.
   *
   * <p><b>Not the same news as {@link recencyRestricted}, and it must not share its sentence</b>
   * (`../docs/backlog.md` item 129). On the directory `lastActivity` blanks a field; here it
   * withholds every entry the patient has. Reusing the list's wording would tell a pharmacist that
   * recent-activity sorting is unavailable when the patient's whole history is missing — a new false
   * sentence, written while removing one.
   *
   * <p>There is deliberately no record-side sibling for `caseAssignments`. It never reaches
   * `GET /api/patients/{id}`: a record whose case read was refused is not served at all, because
   * that collection is what entitlement is decided from (item 112).
   */
  readonly recordActivityRestricted = computed(() => this.recordRestrictedSignal().includes('lastActivity'));

  /** Ids of cached records, oldest first, so the bound can be enforced. */
  private recentRecordIds: string[] = [];

  /**
   * Optimistic entries, kept only in memory.
   *
   * <p>Deliberately NOT written into the cached record: the cache is what the server said, and
   * mixing an unsent note into it would survive a restart as though it had been filed. The queue is
   * the durable half — this is only what to draw while it works.
   */
  private readonly pendingSignal = signal<readonly PendingEntry[]>([]);

  constructor() {
    // The queue owns WHEN a write is attempted; this store owns HOW. Registered here rather than
    // inside the queue so that class never grows a dependency on every feature in the app — and
    // without it a queued op sits pending forever, which is the quietest possible failure.
    this.queue.register('activity.append', write =>
      firstValueFrom(
        this.api.appendActivity(write.subjectId, {
          title: write.payload['title'] as string,
          description: write.payload['description'] as string,
          clientRef: write.clientRef,
        }),
      ),
    );
    this.queue.register('report.append', write =>
      firstValueFrom(
        this.api.appendReport(write.subjectId, {
          name: write.payload['name'] as string,
          reportType: write.payload['reportType'] as string,
          clientRef: write.clientRef,
        }),
      ),
    );
  }

  /**
   * Loads the directory from scratch, honouring the current filters.
   *
   * <p>Serves the cached page first when there is one, so the list is never blank while the request
   * is in flight — the same posture the rest of the app takes toward the cache.
   */
  async refresh(): Promise<void> {
    this.nextPage = 0;
    this.totalSignal.set(0);

    if (this.isUnfiltered()) {
      // Read before the rows and independently of them: a blank recency column served from disk
      // means what it meant on the wire, and a cold start with no signal must say so rather than
      // fall back to "no activity recorded". Re-parsed rather than trusted, so a token written by
      // another release is dropped here exactly as it would be on the wire.
      const cachedRestriction = await this.cache.get<string[]>(RESTRICTED_PARTS_KEY);
      // Shape checked beside the value, not assumed from it: `refresh()` is awaited by `ngOnInit`
      // and nothing catches here, so a cached entry of an unexpected shape would take the screen
      // down rather than lose a marker.
      const cachedTokens = Array.isArray(cachedRestriction?.value) ? cachedRestriction.value : [];
      this.restrictedSignal.set(parseRestrictedParts(cachedTokens.join(',')));

      // Read on the same terms and for the same reason: a saved directory shown with no signal must
      // carry the mark it had on the wire, or the app offers a hundred rows that will not open and
      // says nothing about it — the state item 132 exists to end, surviving in the one place this
      // app is built for.
      const cachedFollowUps = await this.cache.get<string[]>(RESTRICTED_FOLLOW_UPS_KEY);
      const cachedFollowUpTokens = Array.isArray(cachedFollowUps?.value) ? cachedFollowUps.value : [];
      this.followUpsSignal.set(parseRestrictedFollowUps(cachedFollowUpTokens.join(',')));

      const cached = await this.cache.get<PatientListItemDto[]>(FIRST_PAGE_KEY);
      if (cached) {
        this.rowsSignal.set(cached.value);
        this.totalSignal.set(cached.value.length);
        this.cachedAtSignal.set(cached.fetchedAt);
      } else {
        this.rowsSignal.set([]);
      }
    } else {
      this.rowsSignal.set([]);
    }

    await this.loadMore(true);
  }

  private isUnfiltered(): boolean {
    const { query, sex, childrenOnly } = this.filtersSignal();
    return !query && !sex && !childrenOnly;
  }

  /** Applies a filter set and reloads from page zero. */
  async applyFilters(filters: Partial<PatientFilters>): Promise<void> {
    this.filtersSignal.update(current => ({ ...current, ...filters }));
    await this.refresh();
  }

  /**
   * Appends the next page.
   *
   * <p>Failure leaves what is already on screen alone. A directory that empties itself because page
   * three did not arrive is worse than one that simply stops growing.
   */
  async loadMore(replace = false): Promise<void> {
    if (this.loadingSignal()) {
      return;
    }
    this.loadingSignal.set(true);
    this.failedSignal.set(false);
    const { query, sex, childrenOnly } = this.filtersSignal();
    try {
      const response = await firstValueFrom(
        this.api.query({ page: this.nextPage, size: PAGE_SIZE, query, sex: sex ?? undefined, childrenOnly }),
      );
      const rows = response.body ?? [];
      const header = response.headers.get('X-Total-Count');
      const existing = replace ? [] : this.rowsSignal();

      // Set from every page that arrives, including the ones that name nothing: the header is
      // emitted only when something was withheld, so an absent header on a 200 is the server
      // saying the read was complete. A failed request leaves the last answer standing instead —
      // a restriction is a property of the role, which does not change between two requests.
      const restricted = parseRestrictedParts(response.headers.get(RESTRICTED_PARTS_HEADER));
      this.restrictedSignal.set(restricted);

      // The second header, read on the same terms. It is emitted only when a withheld part is one
      // the record path reads strictly, so its absence on a 200 is the server saying these rows can
      // be opened — as far as this read can tell (item 128 states the marker is sufficient, not
      // complete, so absence is not a promise and nothing here makes one).
      const followUps = parseRestrictedFollowUps(response.headers.get(RESTRICTED_FOLLOW_UPS_HEADER));
      this.followUpsSignal.set(followUps);

      // A missing header means "this is everything", not zero: zero would empty a list the server
      // had just filled.
      this.totalSignal.set(header === null ? existing.length + rows.length : Number(header));
      this.rowsSignal.set([...existing, ...rows]);

      // Page zero, unfiltered, is what a clinician sees with no signal. Written from the response
      // in hand rather than fetched a second time. Sealed: a list of the people a clinician is
      // treating should not sit readable in an app sandbox.
      if (this.nextPage === 0 && this.isUnfiltered()) {
        await this.cache.setSensitive(FIRST_PAGE_KEY, rows);
        // In the clear, and written even when empty so that a role which stops being restricted
        // corrects the cached copy rather than inheriting yesterday's marker.
        await this.cache.set(RESTRICTED_PARTS_KEY, [...restricted]);
        // Likewise in the clear and likewise written when empty, so a discipline whose scope is
        // widened stops being told its own records are closed rather than inheriting yesterday's
        // answer until the cache expires.
        await this.cache.set(RESTRICTED_FOLLOW_UPS_KEY, [...followUps]);
        this.cachedAtSignal.set(Date.now());
      }
      this.nextPage += 1;
    } catch {
      this.failedSignal.set(true);
    } finally {
      this.loadingSignal.set(false);
    }
  }

  /**
   * Opens one patient's record, from cache first and then from the network.
   *
   * <p>Cached individually and **sealed**: a record carries diagnoses, medications and clinical
   * notes, and the roster and document metadata that stay in the clear are nothing like it.
   *
   * <p>Shows the cached copy immediately so the screen is never blank, then replaces it. On failure
   * the cached copy stays — a record a clinician opened this morning is still worth reading in a
   * basement, marked as what it is.
   *
   * <p><b>And marked as <i>partial</i> where it is partial.</b> `X-Restricted-Parts` is read here
   * for the same reason `loadMore` reads it: a record served without its activity panel is
   * indistinguishable from a patient nobody has touched, and on a record that is a clinical reading
   * rather than a cosmetic one (item 126).
   */
  async openRecord(patientId: string): Promise<void> {
    this.recordFailedSignal.set(false);
    const key = `patients.record.${patientId}`;

    // Read before the record and independently of it, exactly as `refresh()` reads the directory's:
    // a cached record shown on a cold start must carry the mark it had on the wire, or the app
    // re-tells the lie with no signal and no way for a clinician to know. Re-parsed rather than
    // trusted, so a token written by another release is dropped here as it would be on the wire.
    const cachedRestriction = await this.cache.get<string[]>(RECORD_RESTRICTED_PARTS_KEY);
    // Shape checked beside the value: nothing catches around this read, so a cached entry of an
    // unexpected shape would take the record down rather than lose a marker.
    const cachedTokens = Array.isArray(cachedRestriction?.value) ? cachedRestriction.value : [];
    this.recordRestrictedSignal.set(parseRestrictedParts(cachedTokens.join(',')));

    const cached = await this.cache.get<PatientRecordDto>(key);
    this.recordSignal.set(cached?.value ?? null);
    this.recordLoadingSignal.set(cached === null);

    try {
      const response = await firstValueFrom(this.api.find(patientId));

      // Set from every answer that arrives, including the ones that name nothing: the header is
      // emitted only when something was withheld, so its absence on a 200 is the server saying the
      // record was composed whole. A failed read leaves the last answer standing instead — a
      // restriction is a property of the role, which does not change between two requests.
      const restricted = parseRestrictedParts(response.headers.get(RESTRICTED_PARTS_HEADER));
      this.recordRestrictedSignal.set(restricted);

      const fresh = response.body;
      this.recordSignal.set(fresh);
      if (fresh) {
        await this.cache.setSensitive(key, fresh);
        await this.remember(patientId);
      }
      // In the clear, unlike the record itself, and written even when empty so that a role which
      // stops being restricted corrects the cached copy rather than inheriting yesterday's marker.
      // It names a capability of the signed-in role, not anything about a patient — which is also
      // why one key serves every record rather than one key per patient.
      await this.cache.set(RECORD_RESTRICTED_PARTS_KEY, [...restricted]);
    } catch {
      this.recordFailedSignal.set(cached === null);
    } finally {
      this.recordLoadingSignal.set(false);
    }
  }

  /**
   * Files an activity-log entry — through the queue, never straight to HTTP.
   *
   * <p>The entry appears on the record immediately, <b>marked</b> as unsent rather than merged in
   * indistinguishably. `web/`'s repository does the latter, which is fine at an 80 ms round trip on
   * a desk and is not fine on a phone that may hold the write for hours: a clinician scrolling a
   * record must never be shown something that looks filed and is not.
   *
   * <p>The optimistic entry carries the queued op's id so the chip can follow its state, and it is
   * replaced by the server's own copy on the next successful read.
   */
  async fileActivity(patientId: string, entry: { title: string; description: string }): Promise<void> {
    const write = await this.queue.submit('activity.append', patientId, { patientId, ...entry });
    this.pendingSignal.update(existing => [...existing, { write, patientId, kind: 'activity', label: entry.title }]);
  }

  /** Files a clinical report. Metadata only — see `PatientApiService.appendReport`. */
  async fileReport(patientId: string, report: { name: string; reportType: string }): Promise<void> {
    const write = await this.queue.submit('report.append', patientId, { patientId, ...report });
    this.pendingSignal.update(existing => [...existing, { write, patientId, kind: 'report', label: report.name }]);
  }

  /** Unsent entries for the record currently open, so they render above the filed ones. */
  readonly pendingForOpenRecord = computed(() => {
    const open = this.recordSignal()?.id;
    if (!open) {
      return [];
    }
    const live = new Set(this.queue.writes().map(write => write.id));
    return (
      this.pendingSignal()
        .filter(entry => entry.patientId === open)
        // An op that has left the queue has landed; the next read shows the server's own copy.
        .filter(entry => live.has(entry.write.id))
        .map(entry => ({
          ...entry,
          state: this.queue.writes().find(write => write.id === entry.write.id)?.state ?? 'pending',
        }))
    );
  });

  closeRecord(): void {
    this.recordSignal.set(null);
    this.recordFailedSignal.set(false);
  }

  /** Keeps the cached-record set bounded, dropping the least recently opened. */
  private async remember(patientId: string): Promise<void> {
    this.recentRecordIds = [...this.recentRecordIds.filter(id => id !== patientId), patientId];
    while (this.recentRecordIds.length > RECORD_CACHE_LIMIT) {
      const evicted = this.recentRecordIds.shift();
      if (evicted) {
        await this.cache.remove(`patients.record.${evicted}`);
      }
    }
  }
}
