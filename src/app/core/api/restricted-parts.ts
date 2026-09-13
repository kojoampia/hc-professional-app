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
  if (!header) {
    return [];
  }
  const named = new Set(header.split(',').map(token => token.trim()));
  return RESTRICTED_PARTS.filter(part => named.has(part));
}
