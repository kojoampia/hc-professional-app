import { Injectable, computed, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';

/**
 * The only persistent home for the refresh token.
 *
 * Three rules this class exists to enforce, all asserted by spec:
 *
 * 1. **The access token is never persisted.** It lives in a memory signal here and
 *    dies with the process. Only the refresh token reaches the OS keystore.
 * 2. **Nothing is ever written to `localStorage`/`sessionStorage`.** The plugin ships a
 *    `SecureStorageWeb` implementation that is localStorage-backed; using it in the
 *    browser would put a long-lived credential somewhere any script can read. So on
 *    web (`ionic serve`, Jest, Playwright) we deliberately bypass the plugin entirely
 *    and use an in-memory map instead — dev keeps working, and the invariant holds
 *    on every platform rather than only on device.
 * 3. **A refresh token is persisted only when the OS has something protecting it.**
 *    `persistRefreshToken` refuses to write on a device with no screen lock and keeps
 *    the token in memory for the session instead, so the user signs in again on every
 *    cold start. See {@link setDeviceProtected}.
 */
@Injectable({ providedIn: 'root' })
export class SecureTokenStore {
  /** Key prefix, so a future co-tenant on the same keychain cannot collide with us. */
  private static readonly KEY_PREFIX = 'hpd_';
  private static readonly REFRESH_TOKEN_KEY = 'refresh_token';

  /** Access token — memory only, never persisted anywhere. */
  private readonly accessTokenSignal = signal<string | null>(null);
  readonly accessToken = this.accessTokenSignal.asReadonly();

  /**
   * Epoch millis at which the access token expires, derived from the server's
   * `expires_in`. Lets callers pre-empt expiry rather than wait to be told by a 401.
   */
  private readonly expiresAtSignal = signal<number | null>(null);
  readonly expiresAt = this.expiresAtSignal.asReadonly();

  readonly hasAccessToken = computed(() => this.accessTokenSignal() !== null);

  /**
   * Whether the OS reports any screen lock. Set at startup by the unlock flow.
   * Defaults to `true` so a failed biometry probe errs toward using the keystore
   * rather than silently downgrading every session to memory-only.
   */
  private deviceProtected = true;

  /** Web-only fallback store. Never touched on a protected native platform. */
  private readonly memoryStore = new Map<string, string>();

  private prefixApplied = false;

  setAccessToken(token: string, expiresInSeconds?: number): void {
    this.accessTokenSignal.set(token);
    this.expiresAtSignal.set(expiresInSeconds === undefined ? null : Date.now() + expiresInSeconds * 1000);
  }

  clearAccessToken(): void {
    this.accessTokenSignal.set(null);
    this.expiresAtSignal.set(null);
  }

  /**
   * True when the access token is absent or within `skewMs` of expiring. The skew
   * matters: refreshing exactly at expiry races the request that needs the token.
   */
  isAccessTokenStale(skewMs = 30_000): boolean {
    if (this.accessTokenSignal() === null) {
      return true;
    }
    const expiresAt = this.expiresAtSignal();
    return expiresAt !== null && expiresAt - skewMs <= Date.now();
  }

  /**
   * Records whether the OS has a screen lock, making durable storage of a
   * long-lived credential conditional on there being something to protect it.
   */
  setDeviceProtected(deviceProtected: boolean): void {
    this.deviceProtected = deviceProtected;
  }

  isDeviceProtected(): boolean {
    return this.deviceProtected;
  }

  async readRefreshToken(): Promise<string | null> {
    if (!this.usesKeystore()) {
      return this.memoryStore.get(SecureTokenStore.REFRESH_TOKEN_KEY) ?? null;
    }
    await this.ensurePrefix();
    const value = await SecureStorage.getItem(SecureTokenStore.REFRESH_TOKEN_KEY);
    return value ?? null;
  }

  /**
   * @returns whether the token reached durable storage. `false` means it is
   *   memory-only and the user must sign in again after a cold start.
   */
  async persistRefreshToken(token: string): Promise<boolean> {
    if (!this.usesKeystore()) {
      this.memoryStore.set(SecureTokenStore.REFRESH_TOKEN_KEY, token);
      return false;
    }
    await this.ensurePrefix();
    await SecureStorage.setItem(SecureTokenStore.REFRESH_TOKEN_KEY, token);
    return true;
  }

  async hasRefreshToken(): Promise<boolean> {
    return (await this.readRefreshToken()) !== null;
  }

  /** Full credential wipe. Part of the logout sequence in mobile-app-plan.md. */
  async clear(): Promise<void> {
    this.clearAccessToken();
    this.memoryStore.clear();
    if (this.isNative()) {
      await this.ensurePrefix();
      await SecureStorage.clear();
    }
  }

  private usesKeystore(): boolean {
    return this.isNative() && this.deviceProtected;
  }

  private async ensurePrefix(): Promise<void> {
    if (this.prefixApplied) {
      return;
    }
    await SecureStorage.setKeyPrefix(SecureTokenStore.KEY_PREFIX);
    this.prefixApplied = true;
  }

  private isNative(): boolean {
    return Capacitor.isNativePlatform();
  }
}
