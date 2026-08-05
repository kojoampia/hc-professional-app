import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';

/**
 * The only persistent home for the refresh token.
 *
 * Two rules this class exists to enforce, both asserted by spec:
 *
 * 1. **The access token is never persisted.** It lives in a memory signal here and
 *    dies with the process. Only the refresh token reaches the OS keystore.
 * 2. **Nothing is ever written to `localStorage`/`sessionStorage`.** The plugin ships a
 *    `SecureStorageWeb` implementation that is localStorage-backed; using it in the
 *    browser would put a long-lived credential somewhere any script can read. So on
 *    web (`ionic serve`, Jest, Playwright) we deliberately bypass the plugin entirely
 *    and use an in-memory map instead — dev keeps working, and the invariant holds
 *    on every platform rather than only on device.
 *
 * MOB5 adds the biometric gate in front of `readRefreshToken()` and the
 * no-screen-lock branch in `persistRefreshToken()`. See mobile-app-plan.md.
 */
@Injectable({ providedIn: 'root' })
export class SecureTokenStore {
  /** Key prefix, so a future co-tenant on the same keychain cannot collide with us. */
  private static readonly KEY_PREFIX = 'hpd_';
  private static readonly REFRESH_TOKEN_KEY = 'refresh_token';

  /** Access token — memory only, never persisted anywhere. */
  private readonly accessTokenSignal = signal<string | null>(null);
  readonly accessToken = this.accessTokenSignal.asReadonly();

  /** Web-only fallback store. Never touched on a native platform. */
  private readonly memoryStore = new Map<string, string>();

  private prefixApplied = false;

  setAccessToken(token: string | null): void {
    this.accessTokenSignal.set(token);
  }

  clearAccessToken(): void {
    this.accessTokenSignal.set(null);
  }

  async readRefreshToken(): Promise<string | null> {
    if (!this.isNative()) {
      return this.memoryStore.get(SecureTokenStore.REFRESH_TOKEN_KEY) ?? null;
    }
    await this.ensurePrefix();
    const value = await SecureStorage.getItem(SecureTokenStore.REFRESH_TOKEN_KEY);
    return value ?? null;
  }

  async persistRefreshToken(token: string): Promise<void> {
    if (!this.isNative()) {
      this.memoryStore.set(SecureTokenStore.REFRESH_TOKEN_KEY, token);
      return;
    }
    await this.ensurePrefix();
    await SecureStorage.setItem(SecureTokenStore.REFRESH_TOKEN_KEY, token);
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
