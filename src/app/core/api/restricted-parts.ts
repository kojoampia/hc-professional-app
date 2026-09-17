/**
 * The parts of a composed read the server was not permitted to fetch on this caller's behalf.
 *
 * <p><b>What the header is.</b> `GET /api/patients` composes its answer from three reads in
 * `professionalservice`, two of which cross to `hc-patient`, where the scope-of-practice matrix
 * lives. A discipline with no scope over one of them used to lose the whole directory — a 503
 * saying it "may clear on retry", which it never would (`../docs/backlog.md` item 107). It now
 * degrades and names what it dropped in an `X-Restricted-Parts` response header, emitted
 * <b>only</b> when something was actually withheld.
 *
 * <p>Measured live on the quality stack: absent for doctor, nurse, paramedic, therapist and carer;
 * `lastActivity` for pharmacist and chemist; `caseAssignments,lastActivity` for technician.
 *
 * <p><b>Why this file exists at all.</b> Item 111's Decision A chose a header over an envelope body
 * precisely because a body change would have broken this app on the release that shipped it — and
 * recorded the cost of that choice at the time: <em>a client that ignores the header renders the
 * blank column exactly as it renders a quiet caseload.</em> That is item 114, and this is the half
 * of it that reads the wire.
 *
 * <p><b>A second header lives here too</b>, `X-Restricted-Follow-Ups` — see below. It is kept in
 * this file rather than in one of its own because the two are one mechanism read twice: the same
 * comma-separated vocabulary, the same drop-the-unknown-token rule, the same reason. Splitting them
 * would be the estate's own <em>two correct copies is how you arrive at one wrong one</em>.
 */

/** The header the two composed reads name themselves in. */
export const RESTRICTED_PARTS_HEADER = 'X-Restricted-Parts';

/**
 * The wire tokens this app understands, as a runtime array.
 *
 * <p>An array rather than a bare union for the reason `DUTY_ROSTER_SHIFTS` is one: a union cannot
 * be enumerated, so nothing can ask whether the catalogues name every value. `restricted-parts.spec`
 * derives its expectations from this list, so a token added here without its four translations
 * fails rather than reaching a screen as a raw key.
 *
 * <p>The order matches `RestrictedPart`'s declaration order in `api/`, which is the order the
 * header promises — but <b>nothing here depends on that promise</b>. {@link parseRestrictedParts}
 * filters this list by what the header names, so a server that reorders its tokens (which it did,
 * unnoticed, until item 107's review found `Set.copyOf` does not preserve order) changes nothing
 * a clinician sees.
 */
export const RESTRICTED_PARTS = ['caseAssignments', 'lastActivity'] as const;

/** The union, derived from the list above rather than written twice. */
export type RestrictedPart = (typeof RESTRICTED_PARTS)[number];

/**
 * Reads the header into the tokens this release knows about.
 *
 * <p><b>An unknown token is dropped, never rendered.</b> The server may add a third part — item 112
 * is open against the two surfaces that still refuse outright — and an older app must go on working
 * rather than printing a wire token, or a missing translation key, at a clinician. The cost is on
 * the record and is accepted: a part this app has never heard of degrades back to the silence that
 * item 114 exists to remove, which is no worse than today and is the only behaviour a release
 * predating the token can honestly offer.
 *
 * <p>An absent, empty or wholly-unrecognised header all give the empty list, and an empty list must
 * leave the screen exactly as it was — five of the eight disciplines never see this header at all.
 */
export function parseRestrictedParts(header: string | null | undefined): readonly RestrictedPart[] {
  return understood(header, RESTRICTED_PARTS);
}

/**
 * The header the <b>directory</b> uses to say that the records behind its rows will not open.
 *
 * <p>Not a part of the answer that went missing, which is what {@link RESTRICTED_PARTS_HEADER} names
 * — a <b>consequence</b> for a read this response is not. `GET /api/patients` degrades when a
 * discipline has no scope over one of the collections it composes; `GET /api/patients/{id}` reads
 * the same collections <b>strictly</b> and refuses outright. So a technician is served a hundred
 * rows, each of which answers 503 when opened, and until item 128 nothing on the wire said so
 * (`../docs/backlog.md` items 128 and 132).
 *
 * <p>Measured live through the quality gateway, 2026-09-17: `record` for technician, absent for
 * pharmacist and nurse.
 */
export const RESTRICTED_FOLLOW_UPS_HEADER = 'X-Restricted-Follow-Ups';

/**
 * The follow-up reads this app understands the server to be refusing, as a runtime array.
 *
 * <p>One value today. It is a list rather than a boolean for the same reason `RESTRICTED_PARTS` is
 * one: the vocabulary belongs to `api/` and may grow, and `restricted-parts.spec` derives the
 * sentences it demands from this array, so a token added here without its four translations fails
 * rather than reaching a screen as a raw key.
 */
export const RESTRICTED_FOLLOW_UPS = ['record'] as const;

/** The union, derived from the list above rather than written twice. */
export type RestrictedFollowUp = (typeof RESTRICTED_FOLLOW_UPS)[number];

/**
 * Reads the follow-up header into the tokens this release knows about.
 *
 * <p>Same rules as {@link parseRestrictedParts}, and deliberately the same code: an unknown token is
 * dropped rather than rendered, order carries no meaning, and an absent or empty header leaves the
 * screen exactly as it was — which is what seven of the eight disciplines get.
 */
export function parseRestrictedFollowUps(header: string | null | undefined): readonly RestrictedFollowUp[] {
  return understood(header, RESTRICTED_FOLLOW_UPS);
}

/**
 * The tokens a header names that a vocabulary contains, in the vocabulary's order.
 *
 * <p>Filtering the <b>vocabulary</b> rather than the header is what makes an unknown token
 * unrenderable instead of merely unhandled, and what makes the result independent of the order the
 * server chose — item 107's review found `Set.copyOf` does not preserve it across JVMs.
 */
function understood<T extends string>(header: string | null | undefined, vocabulary: readonly T[]): readonly T[] {
  if (!header) {
    return [];
  }
  const named = new Set(header.split(',').map(token => token.trim()));
  return vocabulary.filter(token => named.has(token));
}
