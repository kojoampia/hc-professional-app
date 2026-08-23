import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { CATALOGUES } from './catalogues';

/**
 * That every translation key a template names actually exists.
 *
 * <h3>The gap this closes</h3>
 * `catalogues.spec.ts` compares the four locales against each other, so a key missing from all four
 * equally leaves them in perfect agreement and it passes. `untranslated-literals.spec.ts` asserts
 * that visible text *is* a translate call, and `{{ 'patients.readOnly' | translate }}` is one, so it
 * passes too. Neither asks the third question — **does the key the screen names exist** — for any
 * screen except login, which `login.page.spec.ts` renders in four languages.
 *
 * <p>So `patients.readOnly` shipped. ngx-translate renders a missing key as the key itself, which
 * meant the literal text `patients.readOnly` appeared at the bottom of a patient's clinical record,
 * on a real device, with nothing thrown and nothing logged. It was found by looking at a phone.
 *
 * <h3>What it checks, and what it deliberately cannot</h3>
 * Only <b>complete string literals</b> piped to `translate`, passed to `instant()`, or bound to a
 * `*Key` input. A key assembled at runtime — `'me.completion.requirements.' + requirement.key` — is
 * not checkable from source and is skipped; those are covered by the specs that render the component
 * with real data.
 *
 * <p>`hpd-async-banner` derives its offline variant by appending `Offline` to the key it is given,
 * so both spellings are required for every `savedDataKey`. That convention is invisible at the call
 * site, which is exactly the kind of thing that rots.
 */
describe('translation keys named in templates', () => {
  const SRC = join(__dirname, '..', '..');

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap(entry => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        return walk(full);
      }
      return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
    });

  /** Resolves a dotted key against the English catalogue. English is the source of truth here. */
  const exists = (key: string): boolean => {
    let node: unknown = CATALOGUES.en;
    for (const part of key.split('.')) {
      if (typeof node !== 'object' || node === null || !(part in (node as Record<string, unknown>))) {
        return false;
      }
      node = (node as Record<string, unknown>)[part];
    }
    return typeof node === 'string';
  };

  /** Every key a file names, with the spelling the runtime will look up. */
  const keysIn = (source: string): string[] => {
    const found = new Set<string>();
    const add = (key: string): void => void found.add(key);

    // {{ 'a.b' | translate }} and "'a.b' | translate"
    for (const m of source.matchAll(/'([a-zA-Z][\w]*(?:\.[\w]+)+)'\s*\|\s*translate/g)) {
      add(m[1]);
    }
    // translate.instant('a.b')
    for (const m of source.matchAll(/instant\(\s*'([a-zA-Z][\w]*(?:\.[\w]+)+)'/g)) {
      add(m[1]);
    }
    // savedDataKey="a.b" / emptyKey="a.b" / failedKey="a.b" / labelKey="a.b"
    for (const m of source.matchAll(/\b(\w*Key)="([a-zA-Z][\w]*(?:\.[\w]+)+)"/g)) {
      add(m[2]);
      if (m[1] === 'savedDataKey') {
        // The banner appends this at runtime; a missing pair is a blank banner when offline.
        add(`${m[2]}Offline`);
      }
    }
    return [...found];
  };

  const files = walk(SRC).filter(f => f.includes(`${'/'}app${'/'}`) || true);

  it('finds keys to check at all, so a broken matcher cannot pass silently', () => {
    const total = files.flatMap(f => keysIn(readFileSync(f, 'utf8')));

    // A regex that matches nothing would make every assertion below vacuously true.
    expect(total.length).toBeGreaterThan(100);
  });

  it('every key named in a template exists in the catalogues', () => {
    const missing: string[] = [];
    for (const file of files) {
      for (const key of keysIn(readFileSync(file, 'utf8'))) {
        if (!exists(key)) {
          missing.push(`${file.slice(SRC.length + 1)}: ${key}`);
        }
      }
    }

    // Named, not counted: a failure should say which key to add and where it is used.
    expect(missing).toEqual([]);
  });
});
