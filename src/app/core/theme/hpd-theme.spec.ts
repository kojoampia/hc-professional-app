import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { AA_LARGE, AA_NORMAL, contrastRatio, parseHex, relativeLuminance } from './contrast';

/**
 * Guards the BridgeCare design system port (MOB2).
 *
 * These assertions read the REAL stylesheets rather than a duplicated table of
 * values — a spec that restates the constants would pass happily while the
 * shipped CSS said something else. Everything here is a rule from
 * mobile-app-plan.md that is cheap to break and expensive to notice.
 */

const themeDir = resolve(__dirname, '../../../theme');
const read = (file: string): string => readFileSync(resolve(themeDir, file), 'utf8');
const readSrc = (file: string): string => readFileSync(resolve(__dirname, '../../..', file), 'utf8');

const variables = read('variables.css');
const tokens = read('hpd-tokens.css');
const tailwind = read('tailwind.css');
const components = read('hpd-components.css');
const inter = read('inter.css');
const global = readSrc('global.css');

/** Reads a custom property's value out of a stylesheet. */
const cssVar = (css: string, name: string): string => {
  const match = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(css);
  if (!match) {
    throw new Error(`${name} not found`);
  }
  return match[1].trim();
};

/**
 * Drops comments so "this file must not contain X" assertions test CSS rather
 * than prose. Several of these files explain at length why a thing is absent,
 * and naive substring checks match the explanation.
 */
const rules = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The `:root` declaration block, where custom properties are DEFINED. */
const rootBlock = (css: string): string => {
  const match = /:root\s*\{([\s\S]*?)\n\}/.exec(rules(css));
  if (!match) {
    throw new Error(':root block not found');
  }
  return match[1];
};

describe('contrast maths', () => {
  it('parses 3- and 6-digit hex', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('0d3058')).toEqual([13, 48, 88]);
  });

  it('rejects nonsense rather than silently returning a colour', () => {
    expect(() => parseHex('#12345')).toThrow();
    expect(() => parseHex('rebeccapurple')).toThrow();
  });

  it('anchors luminance at the extremes', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('matches the known black-on-white ratio and is symmetric', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2);
    expect(contrastRatio('#0d3058', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#0d3058'), 10);
    expect(contrastRatio('#c59437', '#c59437')).toBeCloseTo(1, 5);
  });
});

describe('the never-white-on-gold rule', () => {
  const gold = '#c59437';
  const onGold = '#3a2a08';

  it('confirms white on gold really does fail — this is why the rule exists', () => {
    const ratio = contrastRatio('#ffffff', gold);
    expect(ratio).toBeCloseTo(2.74, 2);
    expect(ratio).toBeLessThan(AA_LARGE);
  });

  it('confirms the dark tone passes AA on gold', () => {
    expect(contrastRatio(onGold, gold)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('still passes against the gold tint used on hover', () => {
    expect(contrastRatio(onGold, '#ddb868')).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('is enforced in the Ionic layer, which styles components we never touch', () => {
    expect(cssVar(variables, '--ion-color-gold-contrast')).toBe(onGold);
    expect(cssVar(variables, '--ion-color-gold')).toBe(gold);
  });

  it('is enforced in the shared button class', () => {
    expect(components).toMatch(/\.hpd-btn-gold\s*\{[^}]*color:\s*var\(--hpd-color-on-gold\)/);
    expect(cssVar(tokens, '--hpd-color-on-gold')).toBe(onGold);
  });

  it('never sets white as the contrast for any gold-family colour', () => {
    for (const name of ['--ion-color-gold-contrast', '--ion-color-tertiary-contrast']) {
      expect(['#ffffff', '#fff', 'white']).not.toContain(cssVar(variables, name).toLowerCase());
    }
  });
});

describe('every Ionic colour pairs its base with an accessible contrast colour', () => {
  const roles = ['primary', 'secondary', 'tertiary', 'gold', 'success', 'warning', 'danger', 'medium', 'dark'];

  it.each(roles)('%s meets AA for normal text', role => {
    const base = cssVar(variables, `--ion-color-${role}`);
    const contrast = cssVar(variables, `--ion-color-${role}-contrast`);
    expect(contrastRatio(base, contrast)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('light uses dark ink, not white', () => {
    expect(contrastRatio(cssVar(variables, '--ion-color-light'), cssVar(variables, '--ion-color-light-contrast'))).toBeGreaterThanOrEqual(
      AA_NORMAL,
    );
  });
});

describe('surface and text tokens', () => {
  it('body text passes AA on every surface it can land on', () => {
    const ink = cssVar(tokens, '--hpd-color-text-primary');
    for (const surface of ['--hpd-color-surface', '--hpd-color-cream', '--hpd-color-gold-tint']) {
      expect(contrastRatio(ink, cssVar(tokens, surface))).toBeGreaterThanOrEqual(AA_NORMAL);
    }
    expect(contrastRatio(ink, '#ffffff')).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('muted text passes AA on the page surface', () => {
    expect(contrastRatio(cssVar(tokens, '--hpd-color-text-muted'), cssVar(tokens, '--hpd-color-surface'))).toBeGreaterThanOrEqual(
      AA_NORMAL,
    );
  });

  it('the AA-adjusted status tones pass on their own tints', () => {
    for (const [fg, bg] of [
      ['--hpd-color-success', '--hpd-color-success-tint'],
      ['--hpd-color-warning', '--hpd-color-warning-tint'],
      ['--hpd-color-danger', '--hpd-color-danger-tint'],
    ]) {
      expect(contrastRatio(cssVar(tokens, fg), cssVar(tokens, bg))).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it('keeps subtle text out of AA-normal claims — it is large/bold only', () => {
    // Documented in web/professional-web.md as 3.1:1 on white. Asserted so nobody
    // "fixes" a contrast failure by reaching for this token.
    expect(contrastRatio(cssVar(tokens, '--hpd-color-text-subtle'), '#ffffff')).toBeLessThan(AA_NORMAL);
  });
});

describe('the Ionic rgb-triplet trap', () => {
  it('defines every -rgb variable as literal numbers, never var()', () => {
    // Scoped to :root, where the properties are DEFINED. The `.ion-color-gold`
    // aliasing block below it legitimately uses var() to point at these literals —
    // that is Ionic's documented pattern for registering a custom colour.
    const rgbVars = [...rootBlock(variables).matchAll(/(--ion-color-[a-z-]*-rgb)\s*:\s*([^;]+);/g)];
    expect(rgbVars.length).toBeGreaterThan(10);

    for (const [, name, value] of rgbVars) {
      // Ionic feeds these into rgba(); a var() here resolves to nothing and the
      // rule silently disappears rather than erroring.
      expect(`${name} = ${value}`).not.toContain('var(');
      expect(value.trim()).toMatch(/^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/);
    }
  });

  it('keeps each -rgb triplet consistent with its hex base', () => {
    for (const role of ['primary', 'gold', 'success', 'warning', 'danger', 'dark']) {
      const [r, g, b] = parseHex(cssVar(variables, `--ion-color-${role}`));
      expect(cssVar(variables, `--ion-color-${role}-rgb`).replace(/\s/g, '')).toBe(`${r},${g},${b}`);
    }
  });
});

describe('light mode only', () => {
  it('does not import the Ionic dark palette', () => {
    // Restoring this import makes OS dark mode invert the whole navy/cream system.
    // Asserted against rules, not prose — global.css explains at length why the
    // import is absent, and a naive substring check matches the explanation.
    expect(rules(global)).not.toContain('palettes/dark');
    expect(rules(global)).toContain('@ionic/angular/css/core.css');
  });

  it('declares no dark-mode media query or class hook anywhere in the theme', () => {
    for (const css of [global, variables, tokens, components, tailwind]) {
      expect(rules(css)).not.toMatch(/prefers-color-scheme/);
      expect(rules(css)).not.toMatch(/\.ion-palette-dark/);
    }
  });

  it('pins the colour scheme so the browser does not auto-darken form controls', () => {
    expect(variables).toMatch(/color-scheme:\s*light/);
  });
});

describe('Tailwind wiring', () => {
  it('imports only theme and utilities — never the bundle, which drags in preflight', () => {
    expect(tailwind).toContain("@import 'tailwindcss/theme'");
    expect(tailwind).toContain("@import 'tailwindcss/utilities'");
    // Ionic ships its own reset; Tailwind preflight on top breaks ion-* sizing.
    expect(tailwind).not.toMatch(/@import\s+'tailwindcss'\s*;/);
    expect(tailwind).not.toContain('tailwindcss/preflight');
  });

  it('points @source at the app sources, which v4 will not find on its own', () => {
    expect(tailwind).toMatch(/@source\s+'\.\.\/app'/);
  });

  it('maps the hpd palette into @theme so classes copied from web/ resolve', () => {
    for (const alias of ['--color-hpd-primary', '--color-hpd-gold', '--color-hpd-muted', '--color-hpd-danger-tint']) {
      expect(tailwind).toContain(alias);
    }
    expect(tailwind).toMatch(/--radius-hpd\s*:/);
    expect(tailwind).toMatch(/--shadow-hpd-sm\s*:/);
  });

  it('loads tokens before tailwind, since @theme dereferences them', () => {
    expect(global.indexOf('hpd-tokens.css')).toBeLessThan(global.indexOf('tailwind.css'));
  });

  it('loads component classes after tailwind, so they win on equal specificity', () => {
    expect(global.indexOf('tailwind.css')).toBeLessThan(global.indexOf('hpd-components.css'));
  });
});

describe('typography', () => {
  it('self-hosts Inter rather than fetching it, so airplane-mode cold start is branded', () => {
    expect(inter).toContain('@font-face');
    expect(rules(inter)).not.toMatch(/https?:\/\//);
    expect(rules(global)).not.toContain('fonts.googleapis.com');
  });

  it('declares the family as Inter so the copied --hpd-font-body token resolves', () => {
    expect(inter).toMatch(/font-family:\s*'Inter'/);
    expect(cssVar(tokens, '--hpd-font-body')).toMatch(/^Inter,/);
  });

  it('covers the full weight range in one variable file', () => {
    expect(inter).toMatch(/font-weight:\s*100 900/);
  });

  it('uses swap so text paints immediately', () => {
    expect(inter).toMatch(/font-display:\s*swap/);
  });

  it('restores font inheritance for form controls, which Tailwind preflight would otherwise do', () => {
    expect(global).toMatch(/button,\s*input,\s*select,\s*textarea,\s*optgroup\s*\{[^}]*font-family:\s*inherit/);
  });

  it('keeps one family — no second font sneaks in', () => {
    const families = [...rules(global).matchAll(/font-family:\s*([^;]+);/g)].map(m => m[1]);
    for (const family of families) {
      expect(family).toMatch(/inherit|var\(--hpd-font-body\)/);
    }
  });
});

describe('tap targets', () => {
  it('holds buttons at the 44px iOS HIG floor', () => {
    expect(components).toMatch(/\.hpd-btn\s*\{[\s\S]*?min-height:\s*44px/);
    expect(variables).toMatch(/ion-button\s*\{[\s\S]*?min-height:\s*44px/);
  });
});
