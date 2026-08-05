import { Injectable, inject } from '@angular/core';

import { PreferencesService } from '../native/preferences.service';
import { PlatformService } from '../native/platform.service';

export interface DeviceIdentity {
  /** `mobile-ios` / `mobile-android` / `mobile-web`. Presence is what makes the gateway issue a refresh token. */
  client: string;
  /** Stable across launches and reinstalls-within-the-OS-backup. */
  deviceId: string;
  /** Human-readable, for the "signed-in devices" list. */
  deviceName: string;
}

/**
 * Identifies this installation to the gateway.
 *
 * The device id is generated once and kept in Preferences — plain, non-sensitive
 * storage is right for it. It is not a credential: it only lets one physical device
 * be recognised across sessions so the session list is meaningful and a device can
 * replace its own session rather than accumulating one per sign-in.
 */
@Injectable({ providedIn: 'root' })
export class DeviceService {
  private static readonly DEVICE_ID_KEY = 'hpd.deviceId';

  private readonly preferences = inject(PreferencesService);
  private readonly platform = inject(PlatformService);

  private cached: DeviceIdentity | null = null;

  async identity(): Promise<DeviceIdentity> {
    this.cached ??= {
      client: `mobile-${this.platform.name()}`,
      deviceId: await this.deviceId(),
      deviceName: this.platform.describe(),
    };
    return this.cached;
  }

  private async deviceId(): Promise<string> {
    const existing = await this.preferences.get(DeviceService.DEVICE_ID_KEY);
    if (existing) {
      return existing;
    }
    const generated = this.platform.randomId();
    await this.preferences.set(DeviceService.DEVICE_ID_KEY, generated);
    return generated;
  }
}
