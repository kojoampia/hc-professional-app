import { CATALOGUES } from './catalogues';

/**
 * That a locale spells a term one way — the single-token check from `../docs/backlog.md` item 187,
 * ported here by item 189.
 *
 * <p>French wrote both `e-mail` (its own auth flow, five times) and bare `Email` (two scaffold
 * strays) in this one file, and no gate saw it: `catalogues.spec.ts` compares keys,
 * `untranslated-literals.spec.ts` checks the screens use them, and `translated-values.spec.ts`
 * proves a value untranslated by it being <i>identical to English</i> — which `Email` in French is,
 * so it reads as a cognate and is skipped. That is not a gap in the sweep; it is what the sweep is.
 * What convicts `Email` is not English but the same catalogue writing `e-mail` elsewhere: <b>a
 * catalogue that spells one term two ways is wrong in one of them</b>, and that contradiction is
 * derivable with no word list.
 *
 * <p><b>The rule:</b> within one locale, two word tokens that become identical after lowercasing
 * and stripping hyphens, but differ with the hyphens kept, are the same term spelled two ways —
 * red, naming the locale, the token and the keys each spelling lives in. Case alone never fires
 * (sentence position capitalises legitimately — French carries `E-mail` as a standalone label and
 * `e-mail` mid-sentence, deliberately), and each locale is judged only against itself, so `Email`
 * in English and `e-mail` in French are each their locale's settled form. Keys are identifiers,
 * not copy, and are not scanned.
 *
 * <p><b>What this deliberately does not catch</b> — say it here or the next reader assumes a
 * spelling guard covers spelling:
 *
 * <ul>
 *   <li><b>The compound boundary.</b> `E-Mail Adresse` — every token spelled correctly, only the
 *       compound hyphen missing — passes, because two tokens vs one is invisible to a single-token
 *       rule. Joining word bigrams to close that is where the complexity and the false positives
 *       live, and item 187 rejected that half.
 *   <li><b>A consistent wrong spelling.</b> A locale writing bare `Email` in every value fires
 *       nothing — this finds contradiction, not incorrectness. The internal contradiction is the
 *       only evidence a derived check can hold without a maintained word list.
 * </ul>
 *
 * <p><b>There is no allowlist, deliberately.</b> If a genuinely legitimate pair ever appears — one
 * normalised form that really is two different words — the rule is wrong and should be narrowed,
 * not routed around with a list that invites the next entry in on its precedent.
 *
 * <p>This is a <b>second copy</b> of `web/`'s `hyphenation-variance.spec.ts` rather than a shared
 * one — mobile CI clones one repo, the same trade `shift-names.spec.ts` and
 * `document-type-names.spec.ts` already made. It is a port, not a copy: `web/` reads `i18n/*.json`
 * off disk, while these catalogues are a bundled TypeScript module, so only the rule is shared.
 */

/** A word token: letters (any script) with optional single internal hyphens — `E-Mail-Adresse`. */
const TOKEN = /\p{L}+(?:-\p{L}+)+|\p{L}+/gu;

/** Every leaf path and its value, dot-joined, so a hit names the key the fix goes into. */
function entries(value: unknown, prefix = ''): [string, unknown][] {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => entries(child, prefix ? `${prefix}.${key}` : key));
  }
  return [[prefix, value]];
}

/** lowercased-surface-form → the keys that write it, grouped by hyphen-stripped form. */
type SpellingGroups = Map<string, Map<string, string[]>>;

function spellingGroups(locale: keyof typeof CATALOGUES): SpellingGroups {
  const groups: SpellingGroups = new Map();
  for (const [key, value] of entries(CATALOGUES[locale])) {
    if (typeof value !== 'string') {
      continue;
    }
    for (const token of value.match(TOKEN) ?? []) {
      const spelling = token.toLowerCase();
      const normalised = spelling.replace(/-/g, '');
      const spellings = groups.get(normalised) ?? new Map<string, string[]>();
      groups.set(normalised, spellings);
      const locations = spellings.get(spelling) ?? [];
      spellings.set(spelling, locations);
      locations.push(key);
    }
  }
  return groups;
}

describe('hyphenation variance', () => {
  const locales = Object.keys(CATALOGUES) as (keyof typeof CATALOGUES)[];

  it('covers all four locales, so a shrunk catalogue cannot pass this silently', () => {
    expect([...locales].sort()).toEqual(['de', 'en', 'es', 'fr']);
  });

  it('has tokens to compare, so a broken tokeniser cannot pass this suite silently', () => {
    // A variance check over an empty token table asserts nothing at all, quietly and forever. The
    // English catalogue yields roughly 390 distinct tokens today; the threshold is loose so
    // trimming copy does not trip it.
    expect(spellingGroups('en').size).toBeGreaterThan(250);
  });

  it.each(locales)('%s spells each term one way', locale => {
    const found = [...spellingGroups(locale)]
      .filter(([, spellings]) => spellings.size >= 2)
      .map(([normalised, spellings]) => {
        const forms = [...spellings]
          .map(([spelling, locations]) => `"${spelling}" (${locations.slice(0, 3).join(', ')}${locations.length > 3 ? ', …' : ''})`)
          .join(' vs ');
        return (
          `${locale} writes the term "${normalised}" ${spellings.size} ways: ${forms}. One of them is wrong for this ` +
          `locale — settle on one spelling everywhere (item 187 settled email as: de "E-Mail", en "Email", fr "e-mail").`
        );
      });

    expect(found).toEqual([]);
  });
});
