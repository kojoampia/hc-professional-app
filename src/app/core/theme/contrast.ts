/**
 * WCAG 2.1 relative-luminance and contrast-ratio maths.
 *
 * Exists so the Abofonsa BridgeCare colour rules are enforced by a test rather than by
 * convention — above all "never white text on gold", which is the one pairing in
 * this palette that looks fine and fails badly (2.74:1).
 *
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */

/** AA minimum for normal-size body text. */
export const AA_NORMAL = 4.5;
/** AA minimum for large text (>=18.66px bold or >=24px) and UI component boundaries. */
export const AA_LARGE = 3;

export function parseHex(hex: string): [number, number, number] {
  const value = hex.trim().replace(/^#/, '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map(c => c + c)
          .join('')
      : value;

  if (!/^[0-9a-f]{6}$/i.test(full)) {
    throw new Error(`Not a hex colour: ${hex}`);
  }

  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

export function relativeLuminance(hex: string): number {
  const channel = (raw: number): number => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two colours, 1:1 (identical) to 21:1 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
