/**
 * The shape of a write waiting to be sent.
 *
 * <h3>Why `kind` is a union and not a serialized request</h3>
 * The obvious implementation stores an `HttpRequest` and replays it. That fails three ways, and the
 * third is the one that decides it:
 *
 * - It cannot be **re-authorized**. A clinician's role can change between queueing and draining, and
 *   a replayed request carries whatever the old one did.
 * - It cannot be **re-based**. A case that moved, a patient re-filed — the stored URL is stale and
 *   nothing can tell.
 * - It cannot be **described**. The clinician has to be told what is unsent, in words, in their own
 *   language. "POST /api/patients/x/activities" is not that; "Wound dressing note for Ama Mensah"
 *   is. A union of known kinds can be rendered; an opaque request cannot.
 */
export type QueuedWriteKind =
  | 'activity.append'
  | 'report.append'
  | 'case.patch'
  | 'message.reply'
  | 'message.start'
  | 'absence.request'
  | 'absence.withdraw';

/**
 * Where an op is in its life.
 *
 * <p>`conflict` and `rejected` are both terminal for the queue but are not the same thing to a
 * person: a conflict means somebody else edited it and the clinician must re-apply their change; a
 * rejection means the server refused it and re-applying will not help. They are shown differently
 * and neither is retried automatically.
 */
export type QueuedWriteState = 'pending' | 'sending' | 'conflict' | 'rejected' | 'expired';

export interface QueuedWrite {
  id: string;
  kind: QueuedWriteKind;
  /**
   * What the op is about — a patient id, a conversation id, a case id.
   *
   * <p>Ordering is FIFO **per `(kind, subjectId)`**, not globally: two notes on the same patient
   * must arrive in the order they were written, and a note on another patient must not be held up
   * behind them.
   */
  subjectId: string;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  state: QueuedWriteState;
  lastError: string | null;
  /**
   * The idempotency key, generated once at submit and replayed unchanged.
   *
   * <p>Without it, an ambiguous timeout — the request arrived, the response did not — files the
   * same clinical note twice. `api/` keys its write receipts on this exact value.
   */
  clientRef: string;
  /** The op's own arguments. Never a URL, never a header, never a token. */
  payload: Record<string, unknown>;
}

/**
 * Backoff, in milliseconds, indexed by attempt count.
 *
 * <p>First retry is immediate — the common case is a signal that just came back, and making the
 * clinician wait 30 s for something the phone could send now is the wrong first impression. After
 * that it lengthens quickly, because a failure that survives two attempts is usually not transient.
 */
export const RETRY_BACKOFF_MS = [0, 30_000, 120_000, 600_000, 3_600_000] as const;

/**
 * How long an op may stay queued before it is given up on.
 *
 * <p>24 hours, and it moves to `expired` rather than being deleted. A clinical note that cannot be
 * sent must end up somewhere the clinician can see it and copy it out — silently dropping it after
 * a day is the failure this whole queue exists to prevent, arriving late.
 */
export const EXPIRY_MS = 24 * 60 * 60 * 1000;

/** Whether the state means the queue has stopped working on it and a person must decide. */
export function needsAttention(write: QueuedWrite): boolean {
  return write.state === 'conflict' || write.state === 'rejected' || write.state === 'expired';
}

/**
 * How the server's answer maps to what happens next.
 *
 * <p>The table is the whole safety argument, so it is one function with the reasoning attached
 * rather than scattered conditionals:
 *
 * | status | outcome | why |
 * | --- | --- | --- |
 * | 401 | retry | Not the op's fault. `authRefreshInterceptor` refreshes and the replay carries the new token. |
 * | 0, 408, 5xx | retry | Transport. The write is still good. |
 * | 409, 412 | conflict | Somebody else changed it. **Never auto-merge clinical text.** |
 * | 4xx otherwise | rejected | A 403 means this role may not write. Retrying forever hides a permissions problem behind a spinner. |
 */
export function outcomeFor(status: number): 'retry' | 'conflict' | 'rejected' {
  if (status === 0 || status === 401 || status === 408 || status >= 500) {
    return 'retry';
  }
  if (status === 409 || status === 412) {
    return 'conflict';
  }
  return 'rejected';
}
