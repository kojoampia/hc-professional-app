import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { AUTHORITY } from '../auth/clinical-permissions';

/**
 * Guards the store listings under `fastlane/metadata/` — the one user-facing surface in this repo
 * no other check reads, and the most public one: two app stores.
 *
 * <p>It exists because nothing looked. Item 44 removed `ROLE_ANGEL` on 2026-09-08 and the listings
 * went on advertising "care angels" until item 174 on 2026-09-24 — sixteen days, undetected,
 * because the three i18n gates read the catalogues, the untranslated-literals gate reads templates,
 * and `fastlane/` was read by no check at all. See `../docs/backlog.md` item 178.
 *
 * <p>Three checks, and deliberately no fourth. A four-locale positive assertion — every discipline
 * noun in every locale — was considered and refused: the in-app catalogues carry no discipline
 * nouns to derive from, so it would need a hand-written 32-noun table existing for no other
 * purpose, a fifth copy of the very list that drifts, and it would pin the es/de wording before
 * item 177's decision is taken. Do not add it, and do not add a partial version of it.
 */

const projectRoot = resolve(__dirname, '../../../..');
const METADATA_ROOT = resolve(projectRoot, 'fastlane/metadata');

/**
 * The four locales the app ships in — the shipping condition, so a literal list, not a directory
 * read: deriving it from `readdirSync` would let a deleted locale shrink the checks instead of
 * failing them.
 */
const LOCALES = ['en-US', 'es-ES', 'fr-FR', 'de-DE'] as const;

/**
 * Words that name retired authorities, per retired role, matched case-insensitively on word
 * boundaries in every file under `fastlane/metadata/` — the README included, because prose
 * describing the listings goes to the same readers the listings do.
 *
 * <p><strong>The convention: whoever retires a role adds all four locale nouns here as
 * literals, known at retirement time.</strong> Item 44's retirement swept cleanly four locales
 * wide only because all four had kept the English token "care angels" — one word covered en, es,
 * fr and de by luck. The next retired role's noun WILL be translated (a retired `CARER` is
 * `Betreuer` in de), so a denylist that carries only the English noun half-sweeps and reports
 * success. This is the same shape as `ServicesRouteAuthorizationIT` spelling out its angel cases
 * as literals: no reflection over `AUTHORITY` can see a word that is no longer in it, so the
 * retirement itself is the only moment the nouns are known.
 */
const RETIRED_ROLE_WORDS: Record<string, readonly string[]> = {
  // Item 44 (2026-09-08). All four locales used the English token, so one word pair covers them.
  ROLE_ANGEL: ['angel', 'angels'],
};

/** Every file under a directory, recursively. */
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));

const escapeRegExp = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A whole-word, case-insensitive pattern — with Unicode-aware boundaries, which is load-bearing.
 *
 * <p>JavaScript's `\b` is an ASCII word boundary, so a word that <em>starts</em> with a non-ASCII
 * letter — `Ärztinnen`, the de noun for DOCTOR, the likeliest future denylist entry — could never
 * match under it: the entry would be accepted, run green and sweep nothing. A rule that silently
 * matches nothing is this estate's named worst failure mode (`quality/`'s item 91: a malformed
 * rule must fail loudly, not match nothing), and the self-match guard below is the second half of
 * the same defence. Lookarounds on `\p{L}` are the boundary instead; under them `changelogs`
 * still does not contain the word "angel", and "angel" still does not match inside "angels" —
 * which is why singular and plural are separate entries.
 */
const wordPattern = (word: string): RegExp => new RegExp(`(?<!\\p{L})${escapeRegExp(word)}(?!\\p{L})`, 'iu');

describe('store listings', () => {
  describe('the metadata tree carries exactly the four shipping locales', () => {
    // Guards the checks below against passing vacuously: a locale directory that vanished would
    // otherwise just not be compared. `android/` also holds non-locale directories (`whatsnew/`),
    // so the comparison is over locale-shaped names, not everything.
    it.each(['ios', 'android'])('%s', platform => {
      const localeDirs = readdirSync(join(METADATA_ROOT, platform), { withFileTypes: true })
        .filter(entry => entry.isDirectory() && /^[a-z]{2}-[A-Z]{2}$/.test(entry.name))
        .map(entry => entry.name)
        .sort();

      expect(localeDirs).toEqual([...LOCALES].sort());
    });
  });

  describe('no retired authority word anywhere under fastlane/metadata', () => {
    const files = walk(METADATA_ROOT);

    it('is reading a populated tree, not an empty directory', () => {
      // The denylist filters a file list; over an empty list it proves nothing. Eight is the
      // description/full_description count alone — the real tree is far larger.
      expect(files.length).toBeGreaterThanOrEqual(8);
    });

    describe.each(Object.entries(RETIRED_ROLE_WORDS))('%s', (_role, words) => {
      it.each([...words])("the pattern for '%s' can find its own word", word => {
        // The self-match guard: a denylist entry whose pattern cannot locate the entry itself is a
        // rule that matches nothing, and it must fail loudly here — at the point of definition —
        // rather than let the scan below pass vacuously. This is what catches a boundary form or
        // an escaping mistake that quietly disarms a word.
        expect(wordPattern(word).test(word)).toBe(true);
      });

      it.each([...words])("the word '%s' appears in no file", word => {
        // Word boundaries, not substrings: `changelogs` contains "angel" and must not trip this.
        const pattern = wordPattern(word);
        const offenders = files.filter(file => pattern.test(readFileSync(file, 'utf8'))).map(file => relative(projectRoot, file));

        expect(offenders).toEqual([]);
      });
    });
  });

  describe('iOS and Android tell one story per locale', () => {
    // The rule was held only by hand until this spec: the App Store description and the Play full
    // description are the same text, byte for byte, per locale. Fully mechanical — no maintained
    // data — and it means every other check here can read one platform's copy and cover both.
    it.each(LOCALES)('%s: ios description.txt ≡ android full_description.txt', locale => {
      const ios = readFileSync(join(METADATA_ROOT, 'ios', locale, 'description.txt'));
      const android = readFileSync(join(METADATA_ROOT, 'android', locale, 'full_description.txt'));

      if (!ios.equals(android)) {
        // String comparison so Jest prints where they diverge; the byte check above is the
        // authority, because two byte sequences can decode to one string (BOM, invalid sequences).
        expect(android.toString('utf8')).toBe(ios.toString('utf8'));
        throw new Error(`${locale}: the files differ in bytes but decode to identical text — an encoding or BOM difference`);
      }
    });
  });

  describe('the en description names every discipline', () => {
    // Derived, not maintained: the eight disciplines are `AUTHORITY` minus the two authorities the
    // gateway issues to everyone, and every English store noun is the regular lowercase plural of
    // the enum name — doctors, nurses, …, technicians. The whole description is searched rather
    // than the audience sentence alone, because finding "the" sentence would mean parsing prose;
    // today they all live in the WHO IT IS FOR paragraph. The iOS copy is read; the byte-identity
    // check above makes it stand for Android too.
    //
    // If a future discipline pluralises irregularly (MIDWIFE → midwives), this derivation goes red
    // demanding the regular form — deliberately: fail loudly then, and add a small exception map in
    // that change, when the real noun is known. Building the map now would be maintained data for a
    // discipline that does not exist.
    const disciplines = Object.keys(AUTHORITY).filter(name => name !== 'ADMIN' && name !== 'USER');
    const storeNouns = disciplines.map(name => `${name.toLowerCase()}s`);
    const enDescription = readFileSync(join(METADATA_ROOT, 'ios', 'en-US', 'description.txt'), 'utf8').toLowerCase();

    it.each(storeNouns)("names '%s'", noun => {
      // Same Unicode-aware boundary as the denylist. The derived nouns are ASCII today, so this is
      // equivalent to `\b` — it is used so the file carries exactly one boundary idiom.
      expect(enDescription).toMatch(wordPattern(noun));
    });
  });
});
