import { CATALOGUES } from './catalogues';

/**
 * That the other three catalogues say things in their own language — the value-level gate beside
 * the key-level ones (`../docs/backlog.md` item 123).
 *
 * <p>The three gates this file joins are all about **keys**: `catalogues.spec.ts` compares the key
 * sets, `untranslated-literals.spec.ts` proves the screens use them, `template-keys.spec.ts` proves
 * the keys the screens name exist. None of them reads a value, so "translated" and "present in all
 * four catalogues" are different claims and every gate tests the second while the four-languages
 * rule promises the first: paste the English sentence into `ES`, `FR` and `DE` and all three stay
 * green. This is the MOB11 defect one level in — then the keys were right and the screens did not
 * use them; here the screens use them and the values are English.
 *
 * <p><b>The rule: a locale's PROSE must differ from the English; single words are out of scope.</b>
 * The scoping is derived, not enumerated, and it comes from `web/`'s
 * `restricted-part-names.spec.ts`, which states it for its six hand-scoped blocks: <i>these are
 * whole sentences, not a proper noun that reads the same everywhere, so any of them matching
 * English means that locale was left behind.</i> A blanket differs-from-English rule fails on
 * cognates — measured on this catalogue (2026-09-24, 356 English leaves), es carries 2 values
 * identical to English, fr 17 and de 4, and every one is a short cognate that is genuinely the
 * same word (`Messages`, `Documents`, `Patients`, `Type`, `Licence`…). At four or more words the
 * signal is clean: **zero** identical prose strings in any locale. So the threshold is where the
 * measured false positives stop, not a guess — fr's cognate count is eight times es's, which is
 * why "identical to English" alone is too weak a signal to gate on. Below the threshold this gate
 * reads nothing, and that blind spot is <b>occupied in practice, not merely theoretical</b> —
 * `web/`'s same rule leaves its fr/de browser-tab title (`global.title`, identical, no cognate)
 * beneath it, tracked by the content row filed from item 123's review — so a short string's
 * sameness here is unexamined, not endorsed; reaching under four words would take a cognate
 * allowlist of dozens, exactly the rot this file refuses.
 *
 * <p><b>Identical-to-English is evidence, not proof.</b> A failure here has found a candidate for
 * review, not convicted anyone: the honest reading of a hit is "this sentence was probably left in
 * English", and the message says how to clear it either way — translate it, or record in
 * {@link PROVEN_IDENTICAL} the argument that it truly reads the same in that locale.
 */
describe('translated values', () => {
  /** Words in a sentence for a four-word threshold: split on whitespace, placeholders count. */
  const words = (value: string): number => value.trim().split(/\s+/).length;

  /**
   * The measured boundary between prose and cognate (see the docblock). Below it the identical
   * strings are proper nouns and shared words; at it and above, on today's catalogues, they are
   * nothing at all.
   */
  const MIN_PROSE_WORDS = 4;

  /**
   * Values proven to read identically in a locale, each with its argument written beside it.
   *
   * <p><b>Empty, by measurement, and meant to stay that way</b> — the scoping rule above already
   * absorbs every legitimate sameness this catalogue has (the brand never appears here at all;
   * `catalogues.spec.ts` asserts no `brand` key exists to be translated by accident). An entry
   * needs a reason a reviewer can check, like `web/`'s two JHipster needles whose own text reads
   * "(do not translate!)". If entries accumulate, the scoping rule is wrong — fix the rule rather
   * than growing the list, which is how `web/`'s `EXEMPT_FILES` filled up before item 12 emptied
   * it.
   */
  const PROVEN_IDENTICAL: { locale: string; key: string; why: string }[] = [];

  const entries = (value: unknown, prefix = ''): [string, unknown][] =>
    typeof value === 'object' && value !== null
      ? Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => entries(child, prefix ? `${prefix}.${key}` : key))
      : [[prefix, value]];

  const english = new Map(entries(CATALOGUES.en));

  it('has prose to check, so a broken word count cannot pass this suite silently', () => {
    // A derived expectation over an empty list asserts nothing at all, quietly and forever. The
    // English catalogue carries 112 prose strings today; well over 50 unless something is wrong
    // with the counting, and the threshold is loose so trimming copy does not trip it.
    const prose = [...english].filter(([, value]) => typeof value === 'string' && words(value) >= MIN_PROSE_WORDS);

    expect(prose.length).toBeGreaterThan(50);
  });

  it.each(['es', 'fr', 'de'] as const)('says its prose in %s rather than repeating the English', locale => {
    const catalogue = new Map(entries(CATALOGUES[locale]));
    const exempt = new Set(PROVEN_IDENTICAL.filter(entry => entry.locale === locale).map(entry => entry.key));

    const candidates = [...english]
      .filter(
        ([key, value]) => typeof value === 'string' && words(value) >= MIN_PROSE_WORDS && catalogue.get(key) === value && !exempt.has(key),
      )
      .map(
        ([key, value]) =>
          `${key} reads word-for-word as the English does ("${String(value)}") — a candidate for review, not a proven error. ` +
          `Either say it in ${locale}, or add it to PROVEN_IDENTICAL with the reason it genuinely reads the same there.`,
      );

    expect(candidates).toEqual([]);
  });

  it('exempts only values that still need exempting', () => {
    // The rot-guard, so the list cannot outlive its own argument: an entry whose value has since
    // been translated, or whose key is gone, is dead weight that invites the next entry in on its
    // precedent. Vacuously green while the list is empty, which is the intended steady state.
    const stale = PROVEN_IDENTICAL.filter(({ locale, key }) => {
      const value = english.get(key);
      return (
        typeof value !== 'string' ||
        words(value) < MIN_PROSE_WORDS ||
        new Map(entries(CATALOGUES[locale as 'es' | 'fr' | 'de'])).get(key) !== value
      );
    });

    expect(stale).toEqual([]);
  });
});
