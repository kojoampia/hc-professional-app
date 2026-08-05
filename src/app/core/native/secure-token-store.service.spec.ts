import { TestBed } from '@angular/core/testing';

import { SecureTokenStore } from './secure-token-store.service';

const capacitor = { isNativePlatform: jest.fn(() => false) };
const secureStorage = {
  setKeyPrefix: jest.fn(async () => undefined),
  getItem: jest.fn(async () => null as string | null),
  setItem: jest.fn(async () => undefined),
  clear: jest.fn(async () => undefined),
};

jest.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => capacitor.isNativePlatform() },
}));
jest.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: {
    setKeyPrefix: (...args: unknown[]) => secureStorage.setKeyPrefix(...(args as [])),
    getItem: (...args: unknown[]) => secureStorage.getItem(...(args as [])),
    setItem: (...args: unknown[]) => secureStorage.setItem(...(args as [])),
    clear: (...args: unknown[]) => secureStorage.clear(...(args as [])),
  },
}));

describe('SecureTokenStore', () => {
  let store: SecureTokenStore;

  beforeEach(() => {
    jest.clearAllMocks();
    capacitor.isNativePlatform.mockReturnValue(false);
    localStorage.clear();
    sessionStorage.clear();
    TestBed.configureTestingModule({});
    store = TestBed.inject(SecureTokenStore);
  });

  describe('the access token', () => {
    it('starts empty and lives only in memory', () => {
      expect(store.accessToken()).toBeNull();
      store.setAccessToken('header.payload.signature');
      expect(store.accessToken()).toBe('header.payload.signature');
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
    });

    it('is cleared on demand', () => {
      store.setAccessToken('token');
      store.clearAccessToken();
      expect(store.accessToken()).toBeNull();
    });
  });

  describe('on web (ionic serve, Jest, Playwright)', () => {
    it('round-trips the refresh token without touching web storage', async () => {
      await store.persistRefreshToken('refresh-abc');

      await expect(store.readRefreshToken()).resolves.toBe('refresh-abc');
      await expect(store.hasRefreshToken()).resolves.toBe(true);

      // The invariant this class exists for: the plugin's SecureStorageWeb is
      // localStorage-backed, so we must never delegate to it off-device.
      expect(secureStorage.setItem).not.toHaveBeenCalled();
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
    });

    it('reports no refresh token before one is written', async () => {
      await expect(store.readRefreshToken()).resolves.toBeNull();
      await expect(store.hasRefreshToken()).resolves.toBe(false);
    });

    it('wipes memory on clear()', async () => {
      store.setAccessToken('access');
      await store.persistRefreshToken('refresh');

      await store.clear();

      expect(store.accessToken()).toBeNull();
      await expect(store.readRefreshToken()).resolves.toBeNull();
      expect(secureStorage.clear).not.toHaveBeenCalled();
    });
  });

  describe('on a native platform', () => {
    beforeEach(() => capacitor.isNativePlatform.mockReturnValue(true));

    it('writes the refresh token through the keystore plugin', async () => {
      await store.persistRefreshToken('refresh-native');

      expect(secureStorage.setItem).toHaveBeenCalledWith('refresh_token', 'refresh-native');
      expect(localStorage.length).toBe(0);
    });

    it('applies the key prefix once, not per call', async () => {
      await store.persistRefreshToken('a');
      await store.persistRefreshToken('b');
      await store.readRefreshToken();

      expect(secureStorage.setKeyPrefix).toHaveBeenCalledTimes(1);
      expect(secureStorage.setKeyPrefix).toHaveBeenCalledWith('hpd_');
    });

    it('normalises an absent key to null', async () => {
      secureStorage.getItem.mockResolvedValueOnce(null);
      await expect(store.readRefreshToken()).resolves.toBeNull();
    });

    it('clears the keystore on clear()', async () => {
      await store.clear();
      expect(secureStorage.clear).toHaveBeenCalled();
    });
  });
});
