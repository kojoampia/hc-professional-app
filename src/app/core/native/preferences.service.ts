import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

/**
 * Small, non-sensitive key/value state: the device id, the chosen locale, cache
 * bookkeeping.
 *
 * This is `SharedPreferences` on Android and `NSUserDefaults` on iOS — plain
 * files, readable by anything with access to the app sandbox. **Never put a
 * token here.** Credentials go through SecureTokenStore, which uses the OS
 * keystore; the offline cache (MOB6) goes to IndexedDB.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  async get(key: string): Promise<string | null> {
    const { value } = await Preferences.get({ key });
    return value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await Preferences.set({ key, value });
  }

  async remove(key: string): Promise<void> {
    await Preferences.remove({ key });
  }

  async clear(): Promise<void> {
    await Preferences.clear();
  }
}
