import { webcrypto } from 'node:crypto';

/**
 * jsdom ships `crypto.getRandomValues` but **not** `crypto.subtle`, so anything
 * touching WebCrypto fails under test with "cannot read properties of undefined".
 *
 * The offline cache encrypts clinical content with AES-GCM, and mocking that away
 * would make the "unreadable at rest" assertions meaningless — they would prove only
 * that a mock was called. Installing Node's real WebCrypto instead means the specs
 * exercise genuine encryption and genuinely inspect the ciphertext.
 *
 * On device this is never needed: the WebView has SubtleCrypto because
 * `androidScheme: 'https'` makes it a secure context.
 */
if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.subtle === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true });
}
