import { Injectable, inject } from '@angular/core';

import { SecureTokenStore } from '../native/secure-token-store.service';

/** An encrypted blob, as stored. Structured so the IV travels with the ciphertext. */
export interface SealedValue {
  /** Format marker, so a future scheme change is detectable rather than silently mis-decrypted. */
  v: 1;
  /** Base64 initialisation vector — unique per write, never reused with the same key. */
  iv: string;
  /** Base64 AES-GCM ciphertext, authentication tag included. */
  ct: string;
}

export const isSealed = (value: unknown): value is SealedValue =>
  typeof value === 'object' && value !== null && (value as SealedValue).v === 1 && typeof (value as SealedValue).ct === 'string';

const toBase64 = (bytes: ArrayBuffer): string => {
  const view = new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const fromBase64 = (value: string): Uint8Array => Uint8Array.from(atob(value), c => c.charCodeAt(0));

/**
 * Encrypts the parts of the offline cache that hold clinical content.
 *
 * The plan's accepted trade-off is that message bodies are cached for offline
 * reading. IndexedDB is protected only by the platform's full-disk encryption and
 * the app sandbox — adequate for a roster, thin for correspondence on a device that
 * gets lost. So content is sealed with AES-GCM under a key that lives in the OS
 * keystore alongside the refresh token, behind the same biometric gate.
 *
 * <p>What this does and does not buy: an attacker with the unlocked device and the
 * app's own process gains nothing, because the app can decrypt by definition. What
 * it defends is the at-rest case — a pulled flash chip, a filesystem backup, a
 * forensic image — where the sandbox alone is not a boundary.
 *
 * <p>Requires a secure context for `crypto.subtle`. The WebView has one because
 * `androidScheme` is https; see capacitor.config.ts.
 */
@Injectable({ providedIn: 'root' })
export class CacheCryptoService {
  private static readonly KEY_NAME = 'cache_key';
  private static readonly IV_BYTES = 12; // 96 bits, the AES-GCM standard

  private readonly tokens = inject(SecureTokenStore);

  private key: CryptoKey | null = null;

  /**
   * Loads the cache key, generating one on first use.
   *
   * Stored as raw base64 next to the refresh token, so it inherits the keystore's
   * protection and — importantly — is destroyed by the same `clear()` on sign-out.
   * A cache whose key is gone is unreadable even if the IndexedDB rows survive,
   * which makes "wipe on logout" robust against a partial failure.
   */
  private async cryptoKey(): Promise<CryptoKey> {
    if (this.key) {
      return this.key;
    }

    const existing = await this.tokens.readSecret(CacheCryptoService.KEY_NAME);
    if (existing) {
      this.key = await crypto.subtle.importKey('raw', fromBase64(existing) as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
      return this.key;
    }

    const raw = crypto.getRandomValues(new Uint8Array(32)); // AES-256
    await this.tokens.writeSecret(CacheCryptoService.KEY_NAME, toBase64(raw.buffer as ArrayBuffer));
    this.key = await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
    return this.key;
  }

  async seal(value: unknown): Promise<SealedValue> {
    const key = await this.cryptoKey();
    // A fresh IV per write. Reusing one under the same key would break GCM outright,
    // leaking plaintext relationships between records.
    const iv = crypto.getRandomValues(new Uint8Array(CacheCryptoService.IV_BYTES));
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext as BufferSource);
    return { v: 1, iv: toBase64(iv.buffer as ArrayBuffer), ct: toBase64(ct) };
  }

  /**
   * @returns the decrypted value, or `null` when it cannot be read — a rotated key,
   *   a truncated write, or tampering. A cache that cannot be decrypted is simply a
   *   cache miss; it must never surface as an error to the user.
   */
  async open<T>(sealed: SealedValue): Promise<T | null> {
    try {
      const key = await this.cryptoKey();
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(sealed.iv) as BufferSource },
        key,
        fromBase64(sealed.ct) as BufferSource,
      );
      return JSON.parse(new TextDecoder().decode(plaintext)) as T;
    } catch {
      return null;
    }
  }

  /** Drops the in-memory key. The stored copy goes with `SecureTokenStore.clear()`. */
  forget(): void {
    this.key = null;
  }
}
