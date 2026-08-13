import { readFileSync, readdirSync } from 'fs';
import { join, relative, resolve } from 'path';

/**
 * Fails when a component template contains user-visible text that is not translated.
 *
 * <p>`catalogues.spec.ts` already proves the four catalogues hold the same keys. That is a
 * different question from this one, and passing it says nothing about whether the screens actually
 * use those keys — a string hardcoded in a template is perfectly consistent across four catalogues
 * that never mention it.
 *
 * <p>This exists because the same mistake was made three times. The MOB11 i18n retrofit was done by
 * grepping for quoted strings, which cannot see text between tags and cannot see attribute values,
 * so `Write a reply`, `Send` and `Add or renew a document` all survived it and were each found by
 * eye afterwards. A later sweep found sixteen more, including every word on the sign-in screen and
 * the cold-start splash — the first two screens anyone sees. Four languages is a shipping condition
 * for this app (`mobile-app-plan.md` MOB11/MOB13), and nothing enforced it at the point of use.
 *
 * <p><strong>What this does not cover.</strong> It reads templates only. A user-visible string
 * built in TypeScript — an error message, a toast, an alert header — is indistinguishable from a log
 * line or a storage key to a scanner, so those are not checked and must still be got right by hand.
 * `login.page.ts` raises four such messages and routes them through `TranslateService.instant`.
 */

const SOURCE_ROOT = resolve(__dirname, '../..');

/**
 * Surfaces that legitimately ship untranslated, with the reason.
 *
 * Keep this list short and justified. Anything a clinician can reach in normal use belongs in the
 * catalogues, not here.
 */
const EXEMPT_FILES: Record<string, string> = {
  'shell/diagnostics.page.ts': 'MOB1 native-capability probe: a developer tool on the device smoke checklist, not a clinician surface.',
  'shell/theme-gallery.page.ts': 'MOB2 design-system gallery: renders swatches and type specimens for developers, reachable only by typing /theme.',
};

/** Proper nouns, which are the same in every locale. */
const NOT_TRANSLATABLE = ['Abofonsa BridgeCare', 'professional.abofonsa.com'];

/** Attributes whose value is read aloud or displayed. `name`, `slot`, `color` and friends are not. */
const VISIBLE_ATTRIBUTES = [
  'placeholder',
  'aria-label',
  'title',
  'alt',
  'label',
  'header',
  'subHeader',
  'message',
  'cancelText',
  'okText',
  'confirmText',
];

function componentFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return componentFiles(full);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [full] : [];
  });
}

/**
 * The inline template of a component, or null.
 *
 * Walks to the closing backtick rather than regex-matching, because templates contain `${}`
 * interpolations of their own and a lazy match stops at the first one.
 */
function inlineTemplate(source: string): string | null {
  const marker = source.indexOf('template: `');
  if (marker === -1) {
    return null;
  }
  const start = marker + 'template: `'.length;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (char === '\\') {
      i++;
    } else if (char === '$' && source[i + 1] === '{') {
      depth++;
      i++;
    } else if (char === '}' && depth > 0) {
      depth--;
    } else if (char === '`' && depth === 0) {
      return source.slice(start, i);
    }
  }
  return null;
}

/** Removes `@if (...) {`, `@for (...) {`, `@else {` and the rest, parentheses balanced. */
function stripControlFlow(template: string): string {
  let out = '';
  for (let i = 0; i < template.length; i++) {
    const rest = template.slice(i);
    const match = /^@(if|else if|else|for|empty|switch|case|default|defer|placeholder|loading|error)\b/.exec(rest);
    if (!match) {
      out += template[i];
      continue;
    }
    i += match[0].length;
    // Skip the condition, if this keyword takes one. Parens nest: @if (a() > b()).
    while (i < template.length && /\s/.test(template[i])) i++;
    if (template[i] === '(') {
      let depth = 0;
      for (; i < template.length; i++) {
        if (template[i] === '(') depth++;
        else if (template[i] === ')' && --depth === 0) break;
      }
    }
    i--; // the loop's own i++ steps past the ')'
  }
  return out;
}

function visibleText(template: string): string[] {
  const cleaned = stripControlFlow(
    template
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/g, '')
      .replace(/\{\{[\s\S]*?\}\}/g, ' '),
  ).replace(/[{}]/g, ' ');

  const found: string[] = [];
  for (const [, between] of cleaned.matchAll(/>([^<>]*)</g)) {
    const text = between.replace(/&[a-z]+;/gi, ' ').trim();
    if (/[A-Za-z]{2}/.test(text)) {
      found.push(text.replace(/\s+/g, ' '));
    }
  }
  return found;
}

function visibleAttributes(template: string): string[] {
  const cleaned = template.replace(/<!--[\s\S]*?-->/g, '');
  const found: string[] = [];
  for (const attribute of VISIBLE_ATTRIBUTES) {
    // Not [attr]="…" and not (attr)="…": a bound value is an expression, and an expression that
    // needs translating goes through the pipe, which this cannot and need not judge.
    const pattern = new RegExp(`(?<![\\[(\\w-])${attribute}\\s*=\\s*"([^"]*)"`, 'g');
    for (const [, value] of cleaned.matchAll(pattern)) {
      if (!value.includes('{{') && /[A-Za-z]{2}/.test(value)) {
        found.push(`${attribute}="${value}"`);
      }
    }
  }
  return found;
}

function isTranslatable(text: string): boolean {
  const bare = NOT_TRANSLATABLE.reduce((acc, noun) => acc.split(noun).join(' '), text);
  // Punctuation, digits and separators carry no language.
  return /[A-Za-z]{2}/.test(bare.replace(/[·•—–\-:,.()/\d\s]+/g, ' ').trim());
}

describe('templates contain no untranslated text', () => {
  const files = componentFiles(SOURCE_ROOT);

  it('finds components to check, so a broken path cannot pass this suite silently', () => {
    const withTemplates = files.filter(file => inlineTemplate(readFileSync(file, 'utf8')) !== null);

    expect(withTemplates.length).toBeGreaterThanOrEqual(7);
  });

  it.each(files.map(file => [relative(SOURCE_ROOT, file), file]))('%s', (name, file) => {
    if (EXEMPT_FILES[name as string]) {
      return;
    }
    const template = inlineTemplate(readFileSync(file as string, 'utf8'));
    if (template === null) {
      return;
    }

    const offenders = [...visibleText(template), ...visibleAttributes(template)].filter(isTranslatable);

    expect(offenders).toEqual([]);
  });

  it('exempts only surfaces that still exist', () => {
    const missing = Object.keys(EXEMPT_FILES).filter(name => !files.some(file => relative(SOURCE_ROOT, file) === name));

    // An exemption for a deleted file is dead weight that quietly widens to nothing; one for a
    // renamed file silently stops exempting and starts failing, which is at least loud.
    expect(missing).toEqual([]);
  });
});
