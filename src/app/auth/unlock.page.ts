import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent, IonSpinner } from '@ionic/angular/standalone';

import { AuthService, SessionExpiredError } from '../core/auth/auth.service';
import { AccountService } from '../core/auth/account.service';
import { BiometricService } from '../core/native/biometric.service';
import { SecureTokenStore } from '../core/native/secure-token-store.service';

type UnlockState = 'checking' | 'prompting' | 'restoring' | 'offline';

/**
 * The cold-start gate.
 *
 * Decides between "restore the session behind a biometric prompt" and "ask for a
 * password", and is the only place that reads the stored refresh token.
 *
 * The offline case is handled explicitly rather than falling through to the login
 * screen. A clinician who opens the app in a lift has a perfectly good session; the
 * right response is "try again", not "sign in again" — signing them out would
 * discard a valid credential because of a transient network failure.
 */
@Component({
  selector: 'hpd-unlock',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonContent, IonSpinner],
  template: `
    <ion-content>
      <div class="flex min-h-full flex-col items-center justify-center gap-6 px-8 text-center">
        <h1 class="text-2xl font-bold text-hpd-primary">BridgeCare</h1>

        @switch (state()) {
          @case ('offline') {
            <p class="text-hpd-muted">BridgeCare could not reach the server. Your session is still valid.</p>
            <button class="hpd-btn hpd-btn-primary hpd-focusable" (click)="attempt()">Try again</button>
            <button class="hpd-btn hpd-btn-ghost hpd-focusable" (click)="signInInstead()">Sign in with password</button>
          }
          @case ('prompting') {
            <p class="text-hpd-muted">Unlock to continue</p>
            <button class="hpd-btn hpd-btn-primary hpd-focusable" (click)="attempt()">Unlock</button>
            <button class="hpd-btn hpd-btn-ghost hpd-focusable" (click)="signInInstead()">Use password</button>
          }
          @default {
            <ion-spinner name="crescent" aria-label="Restoring your session"></ion-spinner>
          }
        }
      </div>
    </ion-content>
  `,
})
export class UnlockPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly accounts = inject(AccountService);
  private readonly biometrics = inject(BiometricService);
  private readonly tokens = inject(SecureTokenStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly state = signal<UnlockState>('checking');

  /** Three consecutive failures discard the stored credential and force a password sign-in. */
  private failures = 0;
  private static readonly MAX_FAILURES = 3;

  async ngOnInit(): Promise<void> {
    // Probe the device's protection level first: it decides whether a refresh token
    // may be persisted at all, and SecureTokenStore needs to know before it reads.
    let protection: Awaited<ReturnType<BiometricService['protectionLevel']>> = 'none';
    try {
      protection = await this.biometrics.protectionLevel();
    } catch {
      protection = 'none';
    }
    this.tokens.setDeviceProtected(protection !== 'none');

    if (!(await this.tokens.hasRefreshToken())) {
      await this.signInInstead();
      return;
    }
    await this.attempt();
  }

  async attempt(): Promise<void> {
    this.state.set('checking');

    const protection = this.tokens.isDeviceProtected();
    if (protection) {
      try {
        await this.biometrics.authenticate('Unlock BridgeCare Professional');
      } catch {
        this.failures += 1;
        if (this.failures >= UnlockPage.MAX_FAILURES) {
          // Repeated failures are indistinguishable from someone else holding the
          // phone. Drop the credential rather than leave it available to retry.
          await this.auth.discardStoredSession('user');
          await this.signInInstead();
          return;
        }
        this.state.set('prompting');
        return;
      }
    }

    this.state.set('restoring');
    this.auth.refresh().subscribe({
      next: () => {
        this.accounts.identity(true).subscribe(() => void this.router.navigateByUrl(this.returnUrl()));
      },
      error: async (error: unknown) => {
        if (error instanceof SessionExpiredError) {
          // The server has disowned the token — expired, revoked, or the family was
          // killed by reuse detection. AuthService has already cleared it locally.
          await this.signInInstead();
          return;
        }
        // Anything else is a transport problem. Keep the session; offer a retry.
        this.state.set('offline');
      },
    });
  }

  async signInInstead(): Promise<void> {
    await this.router.navigate(['/login'], {
      queryParams: { returnUrl: this.returnUrl() },
      replaceUrl: true,
    });
  }

  private returnUrl(): string {
    const target = this.route.snapshot.queryParamMap.get('returnUrl');
    return target?.startsWith('/') ? target : '/diagnostics';
  }
}
