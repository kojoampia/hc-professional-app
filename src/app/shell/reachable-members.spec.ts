import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * That a page's handlers are reachable from its own template.
 *
 * <h3>The bug this exists for</h3>
 * Phase 6 shipped patient filing complete: a store method, a queue op, an API call, a permission
 * gate (`canFile`) and a full-screen modal with a form. Nothing opened it. `canFile()` was never
 * referenced by the template and `openFiling()` was never called from anywhere. The feature was
 * **unreachable in the running app** and no test noticed, because the only spec for it drove
 * `store.fileActivity(...)` directly — one layer below the wiring that was missing.
 *
 * <p>It was found by opening the app on a phone and looking for the button.
 *
 * <h3>Why a source check rather than a DOM one</h3>
 * The control sits inside an `ion-modal`, and Ionic renders modal content into an overlay that jsdom
 * never instantiates — the same reason the password-reset screens had to become their own component
 * to be testable. A DOM assertion for this control cannot run here at all. What *is* checkable, and
 * is exactly the invariant that broke, is that a member the component defines is named somewhere in
 * the file that defines it.
 *
 * <h3>What it will and will not catch</h3>
 * A member defined and referenced **nowhere in its own file** — dead code, and for a handler that
 * means an unreachable feature. It cannot tell that a button is on a screen a clinician can actually
 * reach, and it does not try to. Private members are skipped: they are ordinary implementation and a
 * linter already covers unused ones.
 */
describe('page members are reachable', () => {
  const APP = join(__dirname, '..');

  /** Angular calls these itself; they are reachable by definition. */
  const LIFECYCLE = new Set([
    'constructor',
    'ngOnInit',
    'ngOnDestroy',
    'ngOnChanges',
    'ngAfterViewInit',
    'ngAfterViewChecked',
    'ngAfterContentInit',
    'ngDoCheck',
  ]);

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap(entry => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        return walk(full);
      }
      return full.endsWith('.page.ts') || full.endsWith('.component.ts') ? [full] : [];
    });

  const dead = (source: string): string[] => {
    const names = new Set<string>();

    // Public methods: `name(args): T {` at two-space indent, not private/readonly/get.
    for (const m of source.matchAll(/^ {2}(?:async )?([a-z][A-Za-z0-9]*)\(/gm)) {
      names.add(m[1]);
    }
    // Public computed/signal members: `readonly name = ...`, excluding inputs and injections which
    // are wired by the framework rather than named in the template.
    for (const m of source.matchAll(/^ {2}readonly ([a-z][A-Za-z0-9]*) = (computed|signal)\(/gm)) {
      names.add(m[1]);
    }

    return [...names].filter(name => {
      if (LIFECYCLE.has(name)) {
        return false;
      }
      // Every mention of the name, minus its own declaration. Two or more means it is used.
      const mentions = source.match(new RegExp(`\\b${name}\\b`, 'g'))?.length ?? 0;
      return mentions < 2;
    });
  };

  const files = walk(APP);

  it('scans a meaningful number of components, so a broken walker cannot pass silently', () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it.each(files.map(f => [f.slice(APP.length + 1), f]))('%s defines nothing it never uses', (_label, file) => {
    // Named, not counted: a failure should say which member is unreachable.
    expect(dead(readFileSync(file, 'utf8'))).toEqual([]);
  });
});
