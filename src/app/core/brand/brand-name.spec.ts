import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CATALOGUES } from '../i18n/catalogues';

/**
 * Guards the brand-name rule.
 *
 * **The product is "Abofonsa BridgeCare" — never "BridgeCare" on its own.** Abofonsa is the
 * company; dropping it makes the name read as an unrelated product. Where a platform truncates
 * hard, the half that survives must be "Abofonsa".
 *
 * These read the REAL platform manifests rather than a duplicated table of strings. `npx cap add`
 * regenerates both files from `capacitor.config.ts`'s `appName`, which is the long form — so
 * re-adding a platform silently reverts the launcher label to a name that overflows on a home
 * screen. That is exactly the regression worth a gate: nothing fails, the app just ships with the
 * wrong name on the one surface every user sees first.
 */

const projectRoot = resolve(__dirname, '../../../..');
const read = (file: string): string => readFileSync(resolve(projectRoot, file), 'utf8');

/** Short form: what fits where the platform truncates. 12 characters. */
const SHORT = 'Abofonsa Pro';

/** Long form: everywhere with room. */
const FULL = 'Abofonsa BridgeCare Professional';

describe('brand name', () => {
  describe('launcher label', () => {
    it('is the short form on Android', () => {
      const strings = read('android/app/src/main/res/values/strings.xml');
      expect(/<string name="app_name">([^<]+)<\/string>/.exec(strings)?.[1]).toBe(SHORT);
    });

    it('is the short form on iOS', () => {
      const plist = read('ios/App/App/Info.plist');
      expect(/<key>CFBundleDisplayName<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1]).toBe(SHORT);
    });

    it('fits the ~12 characters a home screen shows before truncating', () => {
      // Longer than this and Android renders "Abofonsa Pro…" or drops to two lines; iOS
      // middle-truncates. The rule exists so the surviving half is always "Abofonsa".
      expect(SHORT.length).toBeLessThanOrEqual(12);
    });
  });

  describe('the surviving half is always Abofonsa', () => {
    it('never abbreviates to BridgeCare alone', () => {
      expect(SHORT).toContain('Abofonsa');
      expect(SHORT).not.toContain('BridgeCare');
    });

    it.each(Object.keys(CATALOGUES))('holds for the Android biometric dialog title in %s', language => {
      // A system dialog is tight, so it takes the short form for the same reason. The title moved
      // out of biometric.service.ts and into the catalogues when the dialog was translated, so the
      // rule now has to hold in four places instead of one — and a translator, reading a string
      // with no context, is exactly who would render it as "BridgeCare" alone.
      const title = CATALOGUES[language as keyof typeof CATALOGUES].boot.unlockTitle;

      expect(title).toContain('Abofonsa');
      expect(title).not.toMatch(/(?<!Abofonsa )BridgeCare/);
    });
  });

  describe('surfaces with room keep the full name', () => {
    it('capacitor appName', () => {
      // Splash and the task switcher read this; neither truncates the way a launcher does.
      expect(read('capacitor.config.ts')).toContain(`appName: '${FULL}'`);
    });

    it('the Android activity title', () => {
      const strings = read('android/app/src/main/res/values/strings.xml');
      expect(/<string name="title_activity_main">([^<]+)<\/string>/.exec(strings)?.[1]).toBe(FULL);
    });
  });

  describe('the lockup subtitle is the brand word (backlog item 185)', () => {
    // `auth.subtitle` renders directly beneath the hardcoded <h1>Abofonsa BridgeCare</h1> on the
    // sign-in screen (login.page.ts) — the same brand lockup `web/` renders from
    // `healthConnect.brand.product` in its sidebar and auth shell. The two repos name this one
    // surface with different keys, and that is KNOWN and tracked, not an error to fix from here:
    // a sweep by key name is exactly how this string was missed when row 185 was filed.
    //
    // The architect decided "Professional" here is a BRAND word, not a descriptive one. The
    // evidence is the store listing name — "Abofonsa BridgeCare Pro", identical and untranslated
    // in all four locales — and this repo already agreed everywhere else: `auth.unlockReason`
    // says "Abofonsa BridgeCare Professional" untranslated in all four. Only the lockup subtitle
    // had drifted ("Profesional", "Professionnel", "Fachkraft"). Descriptive surfaces stay
    // translated — `web/`'s `global.title` ("Panel profesional", "Tableau de bord
    // professionnel") is deliberately outside this rule.
    it.each(Object.keys(CATALOGUES))('reads "Professional" untranslated in %s', language => {
      expect(CATALOGUES[language as keyof typeof CATALOGUES].auth.subtitle).toBe('Professional');
    });
  });

  it('keeps the bundle id, which is IMMUTABLE on both stores', () => {
    // Renaming the app is a text change; renaming this is a new store listing and a new install
    // base. It carries the full brand already, so it never needs to follow a label change.
    const id = 'com.abofonsa.bridgecare.professional';
    expect(read('capacitor.config.ts')).toContain(`appId: '${id}'`);
    expect(read('android/app/src/main/res/values/strings.xml')).toContain(`<string name="package_name">${id}</string>`);
  });
});
