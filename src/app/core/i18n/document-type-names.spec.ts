import { DOCUMENT_TYPES } from '../api/onboarding-api.service';

import { CATALOGUES, SUPPORTED_LANGUAGES } from './catalogues';

/**
 * That every document type has a name in every bundled catalogue, and that no catalogue names one
 * the server can no longer send.
 *
 * <p>The sibling of `shift-names.spec.ts` beside it, written for the same reason and against the
 * same failure: `documents.page.ts` rendered `type.toLowerCase()` on both surfaces that show a type,
 * so `license` and `nhis` reached a Spanish, French or German reader untouched — backlog item 58,
 * and item 45's defect one field over. Neither existing gate could see it. `catalogues.spec.ts`
 * compares key *sets*, and a group that was never written is not drift; `untranslated-literals.spec.ts`
 * reads templates for visible text and attributes, and an interpolation of a model value is neither.
 *
 * <p><b>The expectation is derived, never listed</b> — from {@link DOCUMENT_TYPES} and from
 * `SUPPORTED_LANGUAGES`. That is why the types are a `const` array with `DocumentType` derived from
 * it rather than the other way round: a union of string literals cannot be enumerated at runtime, so
 * no test can ask it anything. A value added to `api/`'s enum and mirrored into the service fails
 * this spec in all four languages until the catalogues carry it, with nobody having edited this file.
 *
 * <p><b>What this cannot see, and what covers it instead.</b> It cannot see the *wording*: a
 * catalogue holding "Permis de conduire" and one holding "Licence" for DRIVERLICENSE pass this
 * equally. The words are `web/`'s, verbatim, and `documents.page.spec.ts` asserts the ones on screen
 * against them per locale. It also cannot see `api/`'s enum, which is not on this checkout — mobile
 * CI clones one repo — so the link from the enum to this app's mirror of it is still made by hand.
 *
 * @see documents.page.spec.ts, which renders these words on the real screen in all four languages.
 */
describe('document type names', () => {
  const typeNames = (language: keyof typeof CATALOGUES): Record<string, unknown> =>
    CATALOGUES[language].documents.documentTypes as unknown as Record<string, unknown>;

  it('has types to check', () => {
    // A derived expectation over an empty list asserts nothing at all, quietly and forever.
    expect(DOCUMENT_TYPES.length).toBe(9);
  });

  it.each(SUPPORTED_LANGUAGES)('has a %s name for every type', language => {
    // Named rather than counted, so a failure says which key to write.
    expect(DOCUMENT_TYPES.filter(type => !typeNames(language)[type])).toEqual([]);
  });

  it.each(SUPPORTED_LANGUAGES)('names no type %s no longer has', language => {
    const retired = Object.keys(typeNames(language)).filter(key => !DOCUMENT_TYPES.includes(key as (typeof DOCUMENT_TYPES)[number]));

    // `documents.unknownType` deliberately sits outside this group so that this assertion needs no
    // exception list — see the note on it in catalogues.ts.
    expect(retired).toEqual([]);
  });

  it.each(SUPPORTED_LANGUAGES)('has no blank or key-echoing %s name', language => {
    const names = typeNames(language);

    // A key copied into the catalogue to silence the check above passes it and still puts
    // `documents.documentTypes.NHIS` on the screen. An echo has two shapes and only one of them
    // contains the dotted path: the whole key, and the bare `NHIS` somebody pastes when filling a
    // language in a hurry.
    const echoes = (name: string, type: string): boolean => name === type || name.includes('documentTypes');

    expect(DOCUMENT_TYPES.filter(type => String(names[type]).trim() === '' || echoes(String(names[type]), type))).toEqual([]);
  });

  it.each(SUPPORTED_LANGUAGES)('gives every type a distinct %s name', language => {
    const names = typeNames(language);

    // Two credentials that read alike are worse on this screen than one that reads oddly: the list
    // is one row per document and the type is how a clinician tells the rows apart.
    expect(new Set(DOCUMENT_TYPES.map(type => names[type])).size).toBe(DOCUMENT_TYPES.length);
  });

  it.each(SUPPORTED_LANGUAGES)('does not reuse a type name for the unknown-type fallback in %s', language => {
    const fallback = CATALOGUES[language].documents.unknownType;

    // Especially not OTHER's. The fallback means "this build cannot name this"; OTHER is a real
    // value that arrives with a required otherLabel, and conflating them hides a broken row.
    expect(DOCUMENT_TYPES.map(type => typeNames(language)[type])).not.toContain(fallback);
  });
});
