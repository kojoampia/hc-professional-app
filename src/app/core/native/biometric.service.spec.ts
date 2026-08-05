import { TestBed } from '@angular/core/testing';

import { BiometricService } from './biometric.service';

const plugin = {
  checkBiometry: jest.fn(),
  authenticate: jest.fn(async () => undefined),
  addResumeListener: jest.fn(async () => ({ remove: jest.fn() })),
};

jest.mock('@aparajita/capacitor-biometric-auth', () => ({
  BiometricAuth: {
    checkBiometry: (...a: unknown[]) => plugin.checkBiometry(...(a as [])),
    authenticate: (...a: unknown[]) => plugin.authenticate(...(a as [])),
    addResumeListener: (...a: unknown[]) => plugin.addResumeListener(...(a as [])),
  },
  BiometryType: { none: 0, touchId: 1, faceId: 2, fingerprintAuthentication: 3 },
}));

const result = (over: Partial<Record<string, unknown>> = {}) => ({
  isAvailable: false,
  strongBiometryIsAvailable: false,
  biometryType: 0,
  biometryTypes: [],
  deviceIsSecure: false,
  reason: '',
  code: '',
  ...over,
});

describe('BiometricService', () => {
  let service: BiometricService;

  beforeEach(() => {
    jest.clearAllMocks();
    TestBed.configureTestingModule({});
    service = TestBed.inject(BiometricService);
  });

  describe('protectionLevel()', () => {
    it('reports biometry when enrolled', async () => {
      plugin.checkBiometry.mockResolvedValue(result({ isAvailable: true, biometryType: 2, deviceIsSecure: true }));
      await expect(service.protectionLevel()).resolves.toBe('biometry');
    });

    it('falls back to device-credential when a passcode is set but no biometry is enrolled', async () => {
      plugin.checkBiometry.mockResolvedValue(result({ isAvailable: false, biometryType: 0, deviceIsSecure: true }));
      await expect(service.protectionLevel()).resolves.toBe('device-credential');
    });

    it('reports none when the device has no lock at all', async () => {
      plugin.checkBiometry.mockResolvedValue(result({ isAvailable: false, deviceIsSecure: false }));
      await expect(service.protectionLevel()).resolves.toBe('none');
    });

    it('does not claim biometry when hardware is supported but nothing is enrolled', async () => {
      // isAvailable false + a non-none type is the "supported but not enrolled" shape.
      plugin.checkBiometry.mockResolvedValue(result({ isAvailable: false, biometryType: 1, deviceIsSecure: true }));
      await expect(service.protectionLevel()).resolves.toBe('device-credential');
    });
  });

  it('always allows the device credential as a fallback when prompting', async () => {
    await service.authenticate('Unlock BridgeCare Professional');

    expect(plugin.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Unlock BridgeCare Professional', allowDeviceCredential: true }),
    );
  });

  it('propagates a rejected prompt rather than swallowing it', async () => {
    plugin.authenticate.mockRejectedValueOnce(new Error('userCancel'));
    await expect(service.authenticate('reason')).rejects.toThrow('userCancel');
  });

  it('checks biometry before registering a resume listener, as the plugin requires', async () => {
    const order: string[] = [];
    plugin.checkBiometry.mockImplementation(async () => {
      order.push('check');
      return result();
    });
    plugin.addResumeListener.mockImplementation(async () => {
      order.push('listen');
      return { remove: jest.fn() };
    });

    await service.onResume(() => undefined);

    expect(order).toEqual(['check', 'listen']);
  });
});
