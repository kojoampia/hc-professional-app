import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, finalize, map, shareReplay, switchMap, tap } from 'rxjs/operators';

import { ApplicationConfigService } from '../config/application-config.service';
import { PushService } from '../native/push.service';
import { SecureTokenStore } from '../native/secure-token-store.service';
import { MessageSocketService } from '../api/message-socket.service';
import { CacheStore } from '../offline/cache-store.service';
import { DeviceService } from './device.service';
import type { MobileTokenResponse, SignOutReason } from './session.model';

/** Thrown when a refresh cannot succeed and the user must sign in again. */
export class SessionExpiredError extends Error {
  constructor(readonly reason: SignOutReason = 'session-expired') {
    super('Session expired');
    this.name = 'SessionExpiredError';
  }
}

/**
 * Owns the mobile session: password login, refresh-token rotation, and sign-out.
 *
 * Adapted from `web/src/main/webapp/app/core/auth/auth-jwt.service.ts` (web commit
 * 48a12fc), but the shape differs in ways that matter:
 *
 * - Login identifies itself as a mobile client, which is what makes the gateway
 *   issue a refresh token at all (see AuthenticateController). Without `client`
 *   the response is the browser's `{id_token}` and there is nothing to rotate.
 * - The access token is short-lived and lives in memory; the refresh token is the
 *   durable credential.
 * - `logout()` is an ordered sequence, not just a local clear — the server-side
 *   family must be revoked first, while the token is still valid.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApplicationConfigService);
  private readonly tokens = inject(SecureTokenStore);
  private readonly device = inject(DeviceService);
  private readonly push = inject(PushService);
  private readonly cache = inject(CacheStore);
  private readonly socket = inject(MessageSocketService);

  /** Why the last session ended — the login screen reads this to explain itself. */
  private readonly signOutReasonSignal = signal<SignOutReason | null>(null);
  readonly signOutReason = this.signOutReasonSignal.asReadonly();

  /**
   * The in-flight refresh, shared by every caller.
   *
   * Without this, N requests failing 401 at once would fire N refreshes; the first
   * would rotate the token and the rest would present one that had just been spent —
   * which the gateway correctly treats as **reuse detection** and answers by revoking
   * the entire family. Concurrency on the client would look exactly like a stolen
   * token and log the user out. Coalescing is not an optimisation here; it is what
   * keeps rotation and concurrency compatible.
   */
  private refreshInFlight: Observable<string> | null = null;

  isAuthenticated(): boolean {
    return this.tokens.hasAccessToken();
  }

  accessToken(): string | null {
    return this.tokens.accessToken();
  }

  clearSignOutReason(): void {
    this.signOutReasonSignal.set(null);
  }

  /**
   * Password login.
   *
   * @returns whether the refresh token reached durable storage. `false` means the
   *   device has no screen lock and the user will have to sign in again next launch.
   */
  login(username: string, password: string): Observable<boolean> {
    return from(this.device.identity()).pipe(
      switchMap(identity =>
        this.http.post<MobileTokenResponse>(this.config.getEndpointFor('api/authenticate'), {
          username,
          password,
          client: identity.client,
          deviceId: identity.deviceId,
          deviceName: identity.deviceName,
        }),
      ),
      switchMap(response => from(this.applySession(response))),
      tap(() => this.signOutReasonSignal.set(null)),
    );
  }

  /**
   * Exchanges the stored refresh token for a new pair. Concurrent callers share one
   * request.
   *
   * A 401 means the token is spent, revoked or expired — the session is over. Any
   * other failure (offline, DNS, timeout, 5xx) is propagated as-is so callers can
   * distinguish "no network" from "no longer signed in"; conflating the two would
   * sign a user out every time they walked into a lift.
   */
  refresh(): Observable<string> {
    this.refreshInFlight ??= this.performRefresh().pipe(
      finalize(() => (this.refreshInFlight = null)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.refreshInFlight;
  }

  private performRefresh(): Observable<string> {
    return from(this.tokens.readRefreshToken()).pipe(
      switchMap(refreshToken => {
        if (!refreshToken) {
          return throwError(() => new SessionExpiredError());
        }
        return this.http.post<MobileTokenResponse>(this.config.getEndpointFor('api/auth/refresh'), {
          refresh_token: refreshToken,
        });
      }),
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 401) {
          // Spent, revoked, or the family was killed by reuse detection. Clear
          // locally so nothing retries with a credential the server has disowned.
          return from(this.endSession('session-expired')).pipe(switchMap(() => throwError(() => new SessionExpiredError())));
        }
        return throwError(() => error);
      }),
      switchMap(response => from(this.applySession(response))),
      map(() => this.tokens.accessToken() as string),
    );
  }

  /** Stores a freshly issued pair. Returns whether the refresh token was persisted. */
  private async applySession(response: MobileTokenResponse): Promise<boolean> {
    this.tokens.setAccessToken(response.id_token, response.expires_in);
    return this.tokens.persistRefreshToken(response.refresh_token);
  }

  /**
   * Signs out.
   *
   * Order matters and is the order in mobile-app-plan.md: revoke the family
   * server-side **first**, while the refresh token is still valid and still known,
   * then deregister push, then wipe locally. Clearing first would leave a live
   * family on the server that nothing can ever revoke.
   *
   * Never rejects: a sign-out that fails because the network is down must still
   * leave the device signed out.
   */
  logout(reason: SignOutReason = 'user'): Observable<void> {
    return from(this.tokens.readRefreshToken()).pipe(
      switchMap(refreshToken =>
        refreshToken
          ? this.http
              .post<void>(this.config.getEndpointFor('api/auth/logout'), { refresh_token: refreshToken })
              .pipe(catchError(() => of(undefined)))
          : of(undefined),
      ),
      switchMap(() => from(this.endSession(reason))),
    );
  }

  /** Local teardown. Also the path taken when the server has already disowned us. */
  private async endSession(reason: SignOutReason): Promise<void> {
    this.refreshInFlight = null;
    try {
      await this.push.unregister();
    } catch {
      // Push teardown must never block sign-out.
    }
    // Drop the socket before the token goes: a live session must not outlive the
    // credential that authorised it, and deactivate() also stops the reconnect timer
    // that would otherwise keep dialling with a revoked token.
    this.socket.disconnect();
    // Cache before credentials: clearing the keystore first would destroy the AES
    // key and leave the encrypted rows behind, unreadable but present.
    try {
      await this.cache.clear();
    } catch {
      // A cache that will not clear must not strand the user in a signed-in state.
    }
    await this.tokens.clear();
    this.signOutReasonSignal.set(reason);
  }

  /** Discards the stored credential without contacting the server. */
  async discardStoredSession(reason: SignOutReason): Promise<void> {
    await this.endSession(reason);
  }
}
