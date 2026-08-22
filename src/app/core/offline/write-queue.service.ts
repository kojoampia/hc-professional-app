import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

import { AppStateService } from '../native/app-state.service';
import { NetworkService } from '../native/network.service';
import { PlatformService } from '../native/platform.service';
import { CacheStore } from './cache-store.service';
import { EXPIRY_MS, QueuedWrite, QueuedWriteKind, RETRY_BACKOFF_MS, needsAttention, outcomeFor } from './queued-write.model';

/** Where the queue lives in the cache. Sealed, always — see the class note. */
const QUEUE_KEY = 'writeQueue';

/** How long an op may sit before the shell says something about it. */
const NAG_AFTER_MS = 10 * 60 * 1000;

/** What a caller registers to actually perform an op. Returns the server's answer. */
export type WriteSender = (write: QueuedWrite) => Promise<unknown>;

/**
 * Writes that are waiting to be sent.
 *
 * <h3>It sits ABOVE HttpClient, not inside it</h3>
 * `offlineInterceptor` short-circuits **GETs only**, and that stays true. Feature stores call
 * {@link submit} instead of the API service; the queue calls the API service when it decides to. A
 * mutation that reaches `HttpClient` directly still fails loudly, exactly as that interceptor's
 * comment promises. Inverting the rule so mutations get a synthetic success is precisely the failure
 * the comment was written to prevent — this design keeps the invariant instead of trading it away.
 *
 * <h3>Everything here is sealed at rest</h3>
 * A queued op holds clinical content — a wound-dressing note, a diagnosis edit — so it is persisted
 * with `setSensitive`, under the key kept in the OS keystore. Two consequences worth stating rather
 * than discovering:
 *
 * - **`CacheStore.clear()` runs on sign-out and account change, so signing out discards unsent
 *   writes.** That is the correct posture on a ward phone — the alternative is one clinician's
 *   unsent note surviving into another's session — and it is why sign-out must block on a non-empty
 *   queue rather than quietly binning it.
 * - **`CACHE_VERSION` must be bumped whenever the op shape changes.** A stale op decoded into new
 *   types is worse than a lost one.
 *
 * <h3>What it will not do</h3>
 * It does not merge. A 409 stops the op and hands it back to the clinician with the server's
 * message, because automatically reconciling two versions of a clinical note is not a thing software
 * should decide. It does not retry a 403 — that is a permissions problem, and retrying forever hides
 * it behind a spinner. And it never reports success it has not had.
 */
@Injectable({ providedIn: 'root' })
export class WriteQueue {
  private readonly cache = inject(CacheStore);
  private readonly network = inject(NetworkService);
  private readonly appState = inject(AppStateService);
  private readonly platform = inject(PlatformService);

  private readonly writesSignal = signal<readonly QueuedWrite[]>([]);
  /** Everything still queued, in submission order. */
  readonly writes = this.writesSignal.asReadonly();

  /** Ops still expected to send on their own. */
  readonly pending = computed(() => this.writesSignal().filter(w => w.state === 'pending' || w.state === 'sending'));

  /** Ops the queue has stopped working on. A person has to decide what happens to these. */
  readonly needingAttention = computed(() => this.writesSignal().filter(needsAttention));

  /** Whether anything at all is unsent — what sign-out checks. */
  readonly isEmpty = computed(() => this.writesSignal().length === 0);

  /**
   * Whether the shell should say something.
   *
   * <p>Not simply "is there anything queued": a note written seconds ago in a lift is normal and a
   * banner about it is noise. This fires when something has been stuck long enough to be worth a
   * clinician's attention, or has already failed.
   */
  readonly shouldWarn = computed(
    () => this.needingAttention().length > 0 || this.pending().some(write => Date.now() - write.createdAt > NAG_AFTER_MS),
  );

  private readonly senders = new Map<QueuedWriteKind, WriteSender>();
  /** The pass currently running, so a concurrent caller can await it rather than guess. */
  private inFlight: Promise<void> | null = null;
  private drainAgain = false;
  private started = false;
  private wasConnected = true;

  constructor() {
    // The disconnected -> connected edge. Watched as a signal rather than through a plugin
    // listener so this class keeps its single native dependency (PlatformService, for an id) and
    // stays testable with a plain signal.
    effect(() => {
      const connected = this.network.connected();
      const reconnected = connected && !this.wasConnected;
      this.wasConnected = connected;
      if (reconnected && this.started) {
        void this.drain();
      }
    });
  }

  /**
   * Registers how a kind is actually sent.
   *
   * <p>Feature stores own their own API calls; this class owns *when* they happen. Keeping the two
   * apart is what stops the queue growing a dependency on every feature in the app.
   */
  register(kind: QueuedWriteKind, sender: WriteSender): void {
    this.senders.set(kind, sender);
  }

  /** Loads the persisted queue and starts draining on the signals that matter. Idempotent. */
  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;

    const stored = await this.cache.get<QueuedWrite[]>(QUEUE_KEY);
    this.writesSignal.set(stored?.value ?? []);

    await this.appState.initialize();
    // Resume, because a phone that was asleep missed the connectivity edge entirely.
    this.appState.onChange(active => {
      if (active) {
        void this.drain();
      }
    });

    await this.drain();
  }

  /**
   * Queues a write and tries to send it immediately.
   *
   * <p>Returns the queued op rather than the server's answer, because the caller cannot be given
   * one: online it may already have been sent, offline it certainly has not, and a method that
   * sometimes returns a result is a method every caller has to guess about.
   *
   * @param clientRef optional; generated when absent. Supplying one lets a caller make its own
   *   retry idempotent across app restarts.
   */
  async submit(kind: QueuedWriteKind, subjectId: string, payload: Record<string, unknown>, clientRef?: string): Promise<QueuedWrite> {
    const write: QueuedWrite = {
      id: this.platform.randomId(),
      kind,
      subjectId,
      createdAt: Date.now(),
      attempts: 0,
      nextAttemptAt: Date.now(),
      state: 'pending',
      lastError: null,
      clientRef: clientRef ?? this.platform.randomId(),
      payload,
    };

    // Consecutive edits to the same case collapse to the latest before sending — last-write-wins
    // locally, which is what the clinician meant by editing twice. APPENDS NEVER COLLAPSE: two
    // activity entries are two events, and merging them loses one.
    const collapsible = kind === 'case.patch';
    const next = collapsible
      ? this.writesSignal().filter(w => !(w.kind === kind && w.subjectId === subjectId && w.state === 'pending'))
      : [...this.writesSignal()];

    await this.persist([...next, write]);
    // Awaited, not fired and forgotten: after this resolves the op has either been sent or is
    // genuinely queued, and a caller can render its pending chip knowing which.
    await this.drain();
    return write;
  }

  /**
   * Sends what is due. Never throws, and never runs twice at once.
   *
   * <p>A request that arrives mid-drain is <b>remembered, not dropped</b>. Dropping it looks
   * harmless — something is already draining — but the op that triggered it may have become due
   * after that pass built its list, and it would then wait for an unrelated event to come along.
   * On a phone that can be the difference between a note leaving now and leaving when the app is
   * next opened.
   */
  async drain(): Promise<void> {
    if (!this.network.connected()) {
      return;
    }
    if (this.inFlight) {
      // Fold into the pass already running, and AWAIT IT. Returning early would make `await drain()`
      // mean "a drain is happening somewhere", which is not something a caller can act on — and it
      // is what made this racy to test, which was the honest signal that it was racy in use too.
      this.drainAgain = true;
      await this.inFlight;
      return;
    }
    this.inFlight = this.runDrain().finally(() => {
      this.inFlight = null;
    });
    await this.inFlight;
  }

  private async runDrain(): Promise<void> {
    do {
      this.drainAgain = false;
      for (const write of this.due()) {
        await this.attempt(write);
      }
    } while (this.drainAgain && this.network.connected());
  }

  /** Re-arms a conflicted or rejected op after the clinician has looked at it. */
  async retry(id: string): Promise<void> {
    await this.patch(id, { state: 'pending', attempts: 0, nextAttemptAt: Date.now(), lastError: null });
    await this.drain();
  }

  /**
   * Drops an op.
   *
   * <p>Only ever called because a person said so. Nothing leaves this queue on its own — an op that
   * expires is kept in an `expired` state so its content is still recoverable.
   */
  async discard(id: string): Promise<void> {
    await this.persist(this.writesSignal().filter(w => w.id !== id));
  }

  /** Clears everything. Sign-out only, after the clinician has been told what they are losing. */
  async discardAll(): Promise<void> {
    await this.persist([]);
  }

  /**
   * Ops whose turn it is, oldest first, one per (kind, subject).
   *
   * <p>The per-subject limit is what keeps FIFO meaningful: sending the second note on a patient
   * before the first has landed would reorder them in the record.
   */
  private due(): QueuedWrite[] {
    const now = Date.now();
    const seen = new Set<string>();
    return this.writesSignal()
      .filter(w => w.state === 'pending' && w.nextAttemptAt <= now)
      .sort((a, b) => a.createdAt - b.createdAt)
      .filter(write => {
        const lane = `${write.kind}:${write.subjectId}`;
        if (seen.has(lane)) {
          return false;
        }
        seen.add(lane);
        return true;
      });
  }

  private async attempt(write: QueuedWrite): Promise<void> {
    const sender = this.senders.get(write.kind);
    if (!sender) {
      // Nothing registered to send this kind — a wiring fault, not the clinician's. Held rather
      // than dropped so it survives to the next launch, where the sender probably exists.
      return;
    }
    if (Date.now() - write.createdAt > EXPIRY_MS) {
      await this.patch(write.id, { state: 'expired', lastError: 'expired' });
      return;
    }

    await this.patch(write.id, { state: 'sending' });
    try {
      await sender(write);
      await this.persist(this.writesSignal().filter(w => w.id !== write.id));
    } catch (error: unknown) {
      await this.recordFailure(write, error);
    }
  }

  private async recordFailure(write: QueuedWrite, error: unknown): Promise<void> {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    const message = error instanceof HttpErrorResponse ? error.error?.detail ?? error.error?.message ?? error.message : String(error);
    const outcome = outcomeFor(status);

    if (outcome === 'conflict') {
      await this.patch(write.id, { state: 'conflict', lastError: message });
      return;
    }
    if (outcome === 'rejected') {
      await this.patch(write.id, { state: 'rejected', lastError: message });
      return;
    }

    const attempts = write.attempts + 1;
    const backoff = RETRY_BACKOFF_MS[Math.min(attempts, RETRY_BACKOFF_MS.length - 1)];
    await this.patch(write.id, {
      state: 'pending',
      attempts,
      nextAttemptAt: Date.now() + backoff,
      lastError: message,
    });
  }

  private async patch(id: string, changes: Partial<QueuedWrite>): Promise<void> {
    await this.persist(this.writesSignal().map(w => (w.id === id ? { ...w, ...changes } : w)));
  }

  private async persist(writes: readonly QueuedWrite[]): Promise<void> {
    this.writesSignal.set(writes);
    // Sealed, always: every payload here is clinical content at rest.
    await this.cache.setSensitive(QUEUE_KEY, writes);
  }
}
