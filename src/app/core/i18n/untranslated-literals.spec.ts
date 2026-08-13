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
 * <p>It checks four places, and each was added because something got through the previous three:
 *
 * <ol>
 *   <li><strong>Text nodes</strong> — `>Sign in<`. The original check.
 *   <li><strong>Visible attributes</strong> — `placeholder="Write a reply"`.
 *   <li><strong>Interpolation expressions</strong> — `{{ isMine(m) ? 'You' : m.senderName }}`. The
 *       first version stripped `{{ … }}` wholesale as "already translated", which is true of the
 *       common case and false of every ternary.
 *   <li><strong>TypeScript prose</strong> — `return 'No shift assigned'`. The first version named
 *       this as a deliberate limitation and left it. Six untranslated strings on the Today card
 *       were reported from a device three days later, so naming it was not enough.
 * </ol>
 *
 * <p><strong>What it still cannot do.</strong> Rule 4 is a heuristic, not a parser: it looks for
 * prose *shape* — a capitalised word followed by lower-case words — plus fallback literals after
 * `||` and `??`. A single capitalised word in TypeScript (`'Offline'`, `'GET'`, `'PENDING'`) is not
 * flagged, because in that position it is far more often an enum or a header than a caption. Strings
 * assembled from fragments at runtime are invisible to it. Services outside component files are not
 * scanned at all.
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
  'shell/theme-gallery.page.ts':
    'MOB2 design-system gallery: renders swatches and type specimens for developers, reachable only by typing /theme.',
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

/**
 * String literals written inside `{{ … }}`.
 *
 * `{{ isMine(m) ? 'You' : m.senderName }}` is user-visible text that no amount of scanning the
 * *text nodes* will find, because the whole interpolation is one expression. This was missed by the
 * first version of this spec, which stripped interpolations wholesale as "already translated".
 */
function interpolationLiterals(template: string): string[] {
  const found: string[] = [];
  for (const [, expression] of template.replace(/<!--[\s\S]*?-->/g, '').matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    // Pipe arguments are formats, not prose: `| date: 'EEE d MMM'` must not be reported.
    const withoutPipeArgs = expression.replace(/\|\s*\w+\s*:\s*(['"])(?:(?!\1).)*\1/g, ' ');
    for (const [, , quoted] of withoutPipeArgs.matchAll(/(['"])((?:(?!\1).)*)\1/g)) {
      // Looser than the TypeScript rule: a literal written inside an interpolation is nearly always
      // displayed, so a single capitalised word counts — `'You'` was the one that got through.
      // `'VERIFIED'` and other server enums do not, because they have no lower-case second letter.
      if (!isTranslationKey(quoted) && /^[A-Z][a-z]/.test(quoted.trim())) {
        found.push(`{{ … '${quoted}' … }}`);
      }
    }
  }
  return found;
}

/**
 * User-visible strings assembled in TypeScript rather than in the template.
 *
 * <p>This is the gap that shipped `No shift assigned`, `Nothing today, ${name}` and four more on
 * the Today card, all while the template scanner reported the file clean — the strings were in
 * `computed()` bodies. The earlier version of this spec named that limitation and left it; it was
 * reported from a device three days later, so naming it was not enough.
 *
 * <p>It cannot be exact. A parser cannot tell a caption from a log line, so this looks only for
 * **prose shape** — a capitalised word followed by lower-case words — in component files, and
 * accepts that a genuinely non-visible string of that shape has to be reworded or exempted.
 */
function typescriptProse(source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  // The inline template is checked by the other functions; scanning it here would double-report.
  const template = inlineTemplate(source);
  const body = template === null ? withoutComments : withoutComments.split(template).join(' ');

  const found: string[] = [];
  for (const [, , quoted] of body.matchAll(/(['"`])((?:(?!\1)[\s\S])*)\1/g)) {
    if (isProse(quoted)) {
      found.push(quoted.replace(/\s+/g, ' ').slice(0, 50));
    }
  }

  // Fallback values are the other shape this takes: `subject || 'Conversation'`. A single
  // capitalised word is too common in TypeScript to flag everywhere — icon names, HTTP verbs,
  // server enums — but as the right-hand side of `||` or `??` it is a default shown to someone.
  for (const [, , quoted] of body.matchAll(/(?:\|\||\?\?)\s*(['"`])([A-Z][a-z]+(?:[\s,][^'"`]*)?)\1/g)) {
    found.push(quoted.replace(/\s+/g, ' ').slice(0, 50));
  }
  return found;
}

function isTranslationKey(literal: string): boolean {
  return /^[a-z][a-zA-Z]*(\.[a-zA-Z]+)+$/.test(literal.trim());
}

/**
 * Does this literal read like something a person is meant to read?
 *
 * A capital followed by lower-case words: "No shift assigned", "Nothing today, ${name}". Not
 * "Bearer " (no second word), not "self-end max-w-[85%]" (lower-case start), not "today.onDuty"
 * (a translation key), not "GET".
 */
function isProse(literal: string): boolean {
  if (isTranslationKey(literal)) {
    return false;
  }
  return /^[A-Z][a-z]+([ ,]+[a-z$][\w${}]*)+/.test(literal.trim());
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
    const source = readFileSync(file as string, 'utf8');
    const template = inlineTemplate(source);
    if (template === null) {
      return;
    }

    const offenders = [
      ...visibleText(template).filter(isTranslatable),
      ...visibleAttributes(template).filter(isTranslatable),
      ...interpolationLiterals(template),
      ...typescriptProse(source),
    ];

    expect(offenders).toEqual([]);
  });

  it('exempts only surfaces that still exist', () => {
    const missing = Object.keys(EXEMPT_FILES).filter(name => !files.some(file => relative(SOURCE_ROOT, file) === name));

    // An exemption for a deleted file is dead weight that quietly widens to nothing; one for a
    // renamed file silently stops exempting and starts failing, which is at least loud.
    expect(missing).toEqual([]);
  });
});
