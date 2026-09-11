import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * That the case detail actually shows the archived banner.
 *
 * <h3>Why a source check rather than a DOM one</h3>
 * The case detail is an `ion-modal`, and Ionic renders modal content into an overlay that jsdom never
 * instantiates. Measured rather than assumed: rendering `CasesPage` with a case open yields
 * `"CasesOpen0Urgent0Closed0AllOpenUrgentClosed No cases in your queue."` — the queue behind it, and
 * nothing of the modal at all. So no assertion about what the detail displays can be made from the
 * DOM here, which is the same wall `reachable-members.spec.ts` and the password-reset component were
 * built around.
 *
 * <p>What each half proves: `archived-banner.component.spec.ts` renders the banner and reads it, in
 * four languages; this asserts that the page names it, and binds it to the field the service sends.
 * Neither is sufficient alone — a perfect banner nothing renders is exactly the shape of the Phase 6
 * filing bug, which shipped complete and unreachable.
 */
describe('CasesPage shows that a case is archived', () => {
  const source = readFileSync(join(__dirname, 'cases.page.ts'), 'utf8');

  it('renders the banner, bound to the case the screen has open', () => {
    // The binding is spelled out rather than matched loosely: bound to the wrong expression the
    // banner either never appears or appears on every case, and both look like working markup.
    expect(source).toContain('<hpd-archived-banner [archivedAt]="clinicalCase.archivedAt">');
  });

  it('imports the component, or the element is inert markup Angular ignores', () => {
    expect(source).toContain('ArchivedBannerComponent');
  });

  it('puts it ABOVE the case itself', () => {
    // The point of a banner. Below the diagnosis it is a footnote to prose that has already been
    // read as current — ../docs/backlog.md item 104 asks for it at the top, and so does the owner.
    const banner = source.indexOf('hpd-archived-banner');
    const brief = source.indexOf("'cases.brief' | translate");

    expect(banner).toBeGreaterThan(-1);
    expect(banner).toBeLessThan(brief);
  });
});
