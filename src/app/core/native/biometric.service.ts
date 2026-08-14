import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { BiometricAuth, BiometryType, type CheckBiometryResult } from '@aparajita/capacitor-biometric-auth';

/** What the unlock flow needs to know about this device's protection level. */
export type DeviceProtection =
  /** Biometry enrolled — prompt and persist the refresh token. */
  | 'biometry'
  /** No biometry but a PIN/pattern/passcode is set — device credential is an acceptable gate. */
  | 'device-credential'
  /** No lock of any kind — do NOT persist the refresh token (mobile-app-plan.md § Biometric unlock). */
  | 'none';

@Injectable({ providedIn: 'root' })
export class BiometricService {
  private readonly translate = inject(TranslateService);

  async check(): Promise<CheckBiometryResult> {
    return BiometricAuth.checkBiometry();
  }

  /**
   * Collapses `checkBiometry()` into the only distinction the unlock flow acts on.
   *
   * The `'none'` case is load-bearing: it is what makes persisting a long-lived
   * credential conditional on the OS having something to protect it with.
   */
  async protectionLevel(): Promise<DeviceProtection> {
    const result = await this.check();
    if (result.isAvailable && result.biometryType !== BiometryType.none) {
      return 'biometry';
    }
    return result.deviceIsSecure ? 'device-credential' : 'none';
  }

  /**
   * Prompts the user. Resolves on success; rejects with a `BiometryError` otherwise —
   * callers must treat rejection as "did not authenticate", not as a crash.
   *
   * <p>The dialog is drawn by the OS, but every word in it is ours, and all three were English
   * until 2026-08-14 — on a German phone the system chrome was German and the text inside it was
   * not. `instant` is safe here because the catalogues are compiled in, and the prompt is built
   * fresh on each call, so it always reflects the language in force at that moment.
   *
   * <p>`androidTitle` keeps the short brand form: it is a system dialog title and truncates hard.
   * See CLAUDE.md § The brand name.
   */
  async authenticate(): Promise<void> {
    await BiometricAuth.authenticate({
      reason: this.translate.instant('boot.unlockReason'),
      allowDeviceCredential: true,
      cancelTitle: this.translate.instant('boot.usePassword'),
      androidTitle: this.translate.instant('boot.unlockTitle'),
    });
  }

  /**
   * Fires when biometric enrollment changes while the app is backgrounded.
   * MOB5 wires this to discard the stored refresh token — without it, someone who
   * adds their own fingerprint to a found phone inherits the session.
   */
  async onResume(listener: (info: CheckBiometryResult) => void): Promise<void> {
    await this.check(); // required by the plugin before addResumeListener()
    await BiometricAuth.addResumeListener(listener);
  }
}
