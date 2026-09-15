import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

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

const walkAll = (dir: string): string[] =>
  readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walkAll(full) : full.endsWith('.ts') ? [full] : [];
  });

/**
 * The public members a class declares.
 *
 * <p>Deliberately the same two shapes for a store as for a page. A `computed` or a method is
 * behaviour somebody was meant to reach; a `readonly x = this.xSignal.asReadonly()` pass-through is
 * state exposure, idiomatic and harmless whether or not a screen happens to read it — flagging those
 * produced nine findings of which four were real, and a guard that mostly cries wolf gets muted.
 */
const publicMembers = (source: string): Set<string> => {
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

  for (const name of LIFECYCLE) {
    names.delete(name);
  }
  return names;
};

describe('page members are reachable', () => {
  const walk = (dir: string): string[] => walkAll(dir).filter(full => full.endsWith('.page.ts') || full.endsWith('.component.ts'));

  const dead = (source: string): string[] =>
    [...publicMembers(source)].filter(name => {
      // Every mention of the name, minus its own declaration. Two or more means it is used.
      const mentions = source.match(new RegExp(`\\b${name}\\b`, 'g'))?.length ?? 0;
      return mentions < 2;
    });

  const files = walk(APP);

  it('scans a meaningful number of components, so a broken walker cannot pass silently', () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it.each(files.map(f => [f.slice(APP.length + 1), f]))('%s defines nothing it never uses', (_label, file) => {
    // Named, not counted: a failure should say which member is unreachable.
    expect(dead(readFileSync(file, 'utf8'))).toEqual([]);
  });
});

/**
 * That a store's public members are read by something other than the store and its own spec.
 *
 * <h3>The bug this exists for, and why the check above could not see it</h3>
 * `PatientsStore.pendingForOpenRecord` was computed, proved green by `patients.store.spec.ts`, and
 * consumed by **nothing**: the record drew no marker on an activity note the write queue was still
 * holding, so a clinician who filed one with no signal watched it disappear into a record that said
 * nothing had happened. `PendingChipComponent` was even imported by `PatientsPage` and never
 * rendered — `ng build` said so on every build (`../docs/backlog.md` item 122).
 *
 * <p>The check above asks whether a member is used **within its own file**, which is the right
 * question for a page and the wrong one for a store: a store's whole purpose is to be read from
 * another file. The guard and the defect were one file apart.
 *
 * <h3>Why a spec does not count as a consumer</h3>
 * That is the entire failure mode. Store-level proof is exactly what the dead member had, and it is
 * what made it look finished. A member whose only readers are tests is a behaviour nobody can reach.
 *
 * <h3>What it will and will not catch</h3>
 * Consumers are the non-spec files that **import the store's module**, so an identically-named member
 * on an unrelated class cannot vouch for this one. Matching is by name, so it is generous the other
 * way — a mention in a comment counts, and a member read only through a dynamic key is invisible.
 * Generous is the right direction: a guard that fails on correct code gets deleted.
 */
describe('store members reach a screen', () => {
  const sources = walkAll(APP);
  const stores = sources.filter(file => file.endsWith('.store.ts'));

  /**
   * Members that reach no screen today, with what is missing behind each.
   *
   * <p>**This list must only shrink.** Every entry is a working store method or computed with no way
   * to reach it in the running app — the same defect item 122 fixed, found by this guard the moment
   * it was written, and each is a separate piece of UI work rather than something item 122 could
   * honestly absorb. They are handed back as a backlog row for `mobile/`.
   *
   * <p>A stale entry fails too, one test below, so wiring one of these up tells you to delete its
   * line rather than leaving a ledger that quietly stops describing anything.
   */
  const KNOWN_UNREACHED: Record<string, Record<string, string>> = {
    'features/messages/messages.store.ts': {
      stop: 'Tears the socket down on sign-out — and nothing calls it, so the socket outlives the session.',
    },
    'features/patients/patients.store.ts': {
      fileReport: 'Queues a clinical report; no screen files one. The record renders an unsent one already.',
    },
    'features/roster/roster.store.ts': {
      showYear: 'Moves the calendar to another year; the roster page offers no year control.',
      withdrawAbsence: 'Withdraws leave, through the queue; the leave list offers no way to withdraw.',
    },
  };

  /** The non-spec files that import this store's module. */
  const importersOf = (store: string): string[] => {
    const module = basename(store, '.ts');
    return sources.filter(
      file => file !== store && !file.endsWith('.spec.ts') && new RegExp(`from '[^']*${module}'`).test(readFileSync(file, 'utf8')),
    );
  };

  const unreached = (store: string): string[] => {
    const consumers = importersOf(store).map(file => readFileSync(file, 'utf8'));
    return [...publicMembers(readFileSync(store, 'utf8'))].filter(name => !consumers.some(text => new RegExp(`\\b${name}\\b`).test(text)));
  };

  it('finds every store, so a broken walker cannot pass silently', () => {
    expect(stores.length).toBeGreaterThan(5);
  });

  it.each(stores.map(f => [f.slice(APP.length + 1), f]))('%s exposes nothing no screen reads', (label, store) => {
    const allowed = Object.keys(KNOWN_UNREACHED[label] ?? {});
    // Named, not counted, and sorted so the message is stable: a failure should say which member.
    expect(unreached(store).sort()).toEqual(allowed.sort());
  });

  it.each(Object.entries(KNOWN_UNREACHED).flatMap(([file, members]) => Object.keys(members).map(member => [file, member])))(
    '%s: %s is still unreached, so its exemption is still earned',
    (label, member) => {
      // The ledger fails when it goes stale as well as when it grows. Wire one of these to a screen
      // and this says so, which is the only thing that keeps the list shrinking.
      expect(unreached(join(APP, label))).toContain(member);
    },
  );
});
