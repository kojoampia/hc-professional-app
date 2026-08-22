import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CATALOGUES, LANGUAGE_NAMES, SUPPORTED_LANGUAGES } from './catalogues';

/**
 * MOB11's gate is "all four locales render with no missing keys", and this is what enforces it.
 *
 * <p>It needs a test rather than review because ngx-translate does not fail on a missing key — it
 * renders the key itself, so `me.signOut` appears verbatim in the middle of a screen. Nothing throws
 * and nothing logs; the only way to notice is to switch language and look. A key added to English
 * and forgotten elsewhere would therefore ship.
 */
describe('translation catalogues', () => {
  const flatten = (value: unknown, prefix = ''): string[] =>
    typeof value === 'object' && value !== null
      ? Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key))
      : [prefix];

  const keysOf = (language: keyof typeof CATALOGUES): string[] => flatten(CATALOGUES[language]).sort();

  /**
   * A key written twice in one group.
   *
   * <p>Read from the <b>source text</b>, because by the time the module is imported the duplicate
   * is gone — JavaScript keeps the last one and every other assertion here sees a perfectly
   * consistent object. That is exactly how one shipped: `messages.close` was added a second time,
   * both the key-parity and the blank-value checks stayed green, and only `tsc` objected.
   *
   * <p>The later value silently wins, so the visible symptom is a string that reverts for no
   * reason when someone edits what looks like the only definition.
   */
  it('defines no key twice — the parity check structurally cannot see this', () => {
    const source = readFileSync(join(__dirname, 'catalogues.ts'), 'utf8');
    const duplicates: string[] = [];
    let group = '';
    const seen = new Map<string, Set<string>>();

    let catalogue = '';
    for (const line of source.split('\n')) {
      // Reset at each catalogue: all four legitimately define `messages.close`, and only a repeat
      // WITHIN one of them is a fault. Without this the check reports every key in the file.
      const catalogueMatch = /^export const ([A-Z]{2})(?:: typeof EN)? = \{$/.exec(line);
      if (catalogueMatch) {
        catalogue = catalogueMatch[1];
        seen.clear();
        continue;
      }
      const groupMatch = /^ {2}([A-Za-z][A-Za-z0-9]*): \{$/.exec(line);
      if (groupMatch) {
        group = groupMatch[1];
        continue;
      }
      const keyMatch = /^ {4}([A-Za-z][A-Za-z0-9]*): /.exec(line);
      if (!keyMatch || !group || !catalogue) {
        continue;
      }
      const bucket = seen.get(group) ?? new Set<string>();
      if (bucket.has(keyMatch[1])) {
        duplicates.push(`${catalogue}: ${group}.${keyMatch[1]}`);
      }
      bucket.add(keyMatch[1]);
      seen.set(group, bucket);
    }

    expect(duplicates).toEqual([]);
  });

  it('ships exactly the four languages web/ does', () => {
    expect([...SUPPORTED_LANGUAGES]).toEqual(['en', 'es', 'fr', 'de']);
    expect(Object.keys(CATALOGUES).sort()).toEqual(['de', 'en', 'es', 'fr']);
  });

  it.each(['es', 'fr', 'de'] as const)('%s has exactly the keys English has — no missing, no extra', language => {
    const english = keysOf('en');
    const other = keysOf(language);

    // Reported as set differences rather than a bare inequality, so a failure names the offending
    // keys instead of printing two long sorted lists to diff by eye.
    expect(other.filter(key => !english.includes(key))).toEqual([]);
    expect(english.filter(key => !other.includes(key))).toEqual([]);
  });

  it.each([...SUPPORTED_LANGUAGES])('%s has no blank or placeholder values', language => {
    const empty: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (typeof value === 'object' && value !== null) {
        Object.entries(value as Record<string, unknown>).forEach(([key, child]) => walk(child, path ? `${path}.${key}` : key));
      } else if (typeof value !== 'string' || value.trim().length === 0) {
        empty.push(path);
      }
    };
    walk(CATALOGUES[language], '');

    // A blank string renders as nothing at all, which is worse than an untranslated key: the button
    // is still there and has no label.
    expect(empty).toEqual([]);
  });

  it('names every shipped language in the picker', () => {
    // A language present in CATALOGUES but absent here is selectable and renders with no name.
    expect(Object.keys(LANGUAGE_NAMES).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
  });

  it('keeps the untranslated brand out of the catalogues', () => {
    // "Abofonsa BridgeCare" is a brand name and must read identically in every language; a
    // translated variant of it in one catalogue is the kind of thing nobody notices for months.
    const all = Object.values(CATALOGUES).flatMap(catalogue => flatten(catalogue));
    expect(all.filter(key => key.toLowerCase().includes('brand'))).toEqual([]);
  });
});
