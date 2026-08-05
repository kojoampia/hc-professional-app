import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { BiometricService } from '../native/biometric.service';
import { SecureTokenStore } from '../native/secure-token-store.service';
import { AccountService } from './account.service';
import { AuthService, SessionExpiredError } from './auth.service';

export type BootOutcome =
  /** A session was restored; go to the app. */
  | 'restored'
  /** No usable stored session; ask for a password. */
  | 'needs-login'
  /** The stored session is fine but unreachable; offer a retry rather than a sign-out. */
  | 'offline'
  /** Biometrics were cancelled or failed; the credential is still stored. */
  | 'locked';

/**
 * The cold-start decision: restore a session, or send the user to sign in.
 *
 * <h3>Why this is a service and not a route</h3>
 * It used to be an `/unlock` page. That made the app's very first navigation a guard
 * redirect, and then the page navigated again from its own `ngOnInit` — two
 * navigations racing before `ion-router-outlet` had finished the first. The outlet
 * never completed the transitions, so every visited page stayed mounted and painted
 * over the next one: the unlock spinner sat on top of the login form, which sat on
 * top of Today.
 *
 * Unlocking is not a destination. It is something that happens before there is
 * anything to navigate to. Making it a service means the router is told exactly once
 * where to go, and the app shell owns the splash while the decision is being made.
 */
@Injectable({ providedIn: 'root' })
export class SessionBootstrapper {
  private readonly auth = inject(AuthService);
  private readonly accounts = inject(AccountService);
  private readonly biometrics = inject(BiometricService);
  private readonly tokens = inject(SecureTokenStore);

  /** Consecutive biometric failures; three discards the stored credential. */
  private failures = 0;
  private static readonly MAX_FAILURES = 3;

  /**
   * @param prompt whether to ask for biometrics. False on the very first probe of a
   *   device with no screen lock, where there is nothing to prompt for.
   */
  async restore(prompt = true): Promise<BootOutcome> {
    // Probe protection first: it decides whether a refresh token may be persisted at
    // all, and SecureTokenStore has to know before it reads.
    let protection: Awaited<ReturnType<BiometricService['protectionLevel']>> = 'none';
    try {
      protection = await this.biometrics.protectionLevel();
    } catch {
      protection = 'none';
    }
    this.tokens.setDeviceProtected(protection !== 'none');

    if (!(await this.tokens.hasRefreshToken())) {
      return 'needs-login';
    }

    if (prompt && protection !== 'none') {
      try {
        await this.biometrics.authenticate('Unlock BridgeCare Professional');
        this.failures = 0;
      } catch {
        this.failures += 1;
        if (this.failures >= SessionBootstrapper.MAX_FAILURES) {
          // Repeated failures are indistinguishable from someone else holding the
          // phone. Drop the credential rather than leave it there to be retried.
          await this.auth.discardStoredSession('user');
          return 'needs-login';
        }
        return 'locked';
      }
    }

    try {
      await firstValueFrom(this.auth.refresh());
    } catch (error: unknown) {
      if (error instanceof SessionExpiredError) {
        // The server has disowned the token — expired, revoked, or the family was
        // killed by reuse detection. AuthService has already cleared it locally.
        return 'needs-login';
      }
      // Anything else is transport. The session is still good; do not throw it away
      // because a lift has no signal.
      return 'offline';
    }

    await firstValueFrom(this.accounts.identity(true));
    return 'restored';
  }
}
