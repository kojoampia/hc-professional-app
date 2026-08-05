import { TestBed } from '@angular/core/testing';

import { PlatformService } from '../native/platform.service';
import { PreferencesService } from '../native/preferences.service';
import { DeviceService } from './device.service';

describe('DeviceService', () => {
  let store: Map<string, string>;
  let randomCalls: number;

  const configure = (platform: string): DeviceService => {
    store = new Map();
    randomCalls = 0;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: PreferencesService,
          useValue: {
            get: async (key: string) => store.get(key) ?? null,
            set: async (key: string, value: string) => void store.set(key, value),
          },
        },
        {
          provide: PlatformService,
          useValue: {
            name: () => platform,
            describe: () => (platform === 'ios' ? 'iPhone' : 'Android device'),
            randomId: () => `generated-${++randomCalls}`,
          },
        },
      ],
    });
    return TestBed.inject(DeviceService);
  };

  it('reports a mobile client string, which is what makes the gateway issue a refresh token', async () => {
    await expect(configure('ios').identity()).resolves.toMatchObject({ client: 'mobile-ios' });
    await expect(configure('android').identity()).resolves.toMatchObject({ client: 'mobile-android' });
  });

  it('generates a device id once and reuses it across launches', async () => {
    const service = configure('ios');
    const first = await service.identity();

    // A new service instance stands in for a fresh launch against the same storage.
    const relaunched = TestBed.inject(DeviceService);
    Object.assign(relaunched, { cached: null });
    const second = await relaunched.identity();

    expect(second.deviceId).toBe(first.deviceId);
    expect(randomCalls).toBe(1);
  });

  it('caches within a session rather than hitting storage repeatedly', async () => {
    const service = configure('ios');
    const a = await service.identity();
    const b = await service.identity();
    expect(b).toBe(a);
  });

  it('carries a human-readable device name for the session list', async () => {
    await expect(configure('ios').identity()).resolves.toMatchObject({ deviceName: 'iPhone' });
  });
});
