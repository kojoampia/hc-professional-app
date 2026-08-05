/** What `POST /api/authenticate` returns to a browser. */
export interface BrowserTokenResponse {
  id_token: string;
}

/**
 * What `POST /api/authenticate` and `POST /api/auth/refresh` return to a mobile
 * client. `refresh_token` and `expires_in` are present only because the request
 * identified itself as mobile — see the gateway's AuthenticateController.
 */
export interface MobileTokenResponse extends BrowserTokenResponse {
  refresh_token: string;
  expires_in: number;
}

/** A live session, from `GET /api/auth/sessions`. Carries no token material. */
export interface DeviceSession {
  id: string;
  client: string | null;
  deviceId: string | null;
  deviceName: string | null;
  issuedAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}

/** Why the session ended — decides what the login screen says. */
export type SignOutReason =
  | 'user'
  /** The refresh token was rejected: expired, revoked, or reuse detected. */
  | 'session-expired'
  /** Biometric enrollment changed while backgrounded; the stored token was discarded. */
  | 'biometry-changed';
