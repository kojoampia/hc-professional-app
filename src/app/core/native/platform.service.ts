import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';

/**
 * Thin wrapper over the platform facts the rest of the app needs, so nothing else
 * has to import `@capacitor/core` and every consumer stays mockable.
 */
@Injectable({ providedIn: 'root' })
export class PlatformService {
  /** `ios` | `android` | `web`. */
  name(): string {
    return Capacitor.getPlatform();
  }

  isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  /** A short description for the session list. */
  describe(): string {
    const platform = this.name();
    return platform === 'web' ? 'Browser' : platform === 'ios' ? 'iPhone' : 'Android device';
  }

  /**
   * A random opaque identifier. Uses `crypto.randomUUID` where available — the
   * WebView is a secure context because `androidScheme` is https, so it is.
   */
  randomId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }
}
