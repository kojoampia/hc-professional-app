import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { IonContent, IonSpinner, NavController } from '@ionic/angular/standalone';

import { AuthService } from '../core/auth/auth.service';
import { AccountService } from '../core/auth/account.service';

@Component({
  selector: 'hpd-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IonContent, IonSpinner],
  template: `
    <ion-content>
      <div class="flex min-h-full flex-col justify-center px-6 py-10">
        <header class="mb-8 text-center">
          <h1 class="text-2xl font-bold text-hpd-primary">Abofonsa BridgeCare</h1>
          <p class="text-hpd-muted">Professional</p>
        </header>

        @if (notice(); as message) {
          <p class="mb-4 rounded-hpd-sm bg-hpd-warning-tint px-4 py-3 text-hpd-warning" role="status">{{ message }}</p>
        }

        <form (ngSubmit)="submit()" #form="ngForm">
          <label class="hpd-label" for="username">Username</label>
          <input
            id="username"
            name="username"
            class="hpd-input mb-4"
            autocomplete="username"
            autocapitalize="none"
            autocorrect="off"
            spellcheck="false"
            inputmode="text"
            required
            [(ngModel)]="username"
            [disabled]="busy()"
          />

          <label class="hpd-label" for="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            class="hpd-input mb-6"
            autocomplete="current-password"
            required
            [(ngModel)]="password"
            [disabled]="busy()"
          />

          @if (error(); as message) {
            <p class="mb-4 rounded-hpd-sm bg-hpd-danger-tint px-4 py-3 text-hpd-danger" role="alert">{{ message }}</p>
          }

          <button type="submit" class="hpd-btn hpd-btn-primary hpd-btn-block hpd-focusable" [disabled]="busy() || form.invalid">
            @if (busy()) {
              <ion-spinner name="crescent"></ion-spinner>
            } @else {
              Sign in
            }
          </button>
        </form>

        @if (unprotectedDevice()) {
          <p class="mt-6 text-center text-hpd-muted">
            This device has no screen lock, so Abofonsa BridgeCare will ask for your password each time you open it.
          </p>
        }
      </div>
    </ion-content>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly accounts = inject(AccountService);
  private readonly nav = inject(NavController);
  private readonly route = inject(ActivatedRoute);

  username = '';
  password = '';

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly unprotectedDevice = signal(false);

  /** Explains an involuntary sign-out, so an expired session is not mistaken for a bug. */
  readonly notice = signal<string | null>(
    {
      'session-expired': 'Your session ended. Please sign in again.',
      'biometry-changed': "This device's biometric settings changed, so you need to sign in again.",
      user: null,
    }[this.auth.signOutReason() ?? 'user'],
  );

  submit(): void {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);

    this.auth.login(this.username.trim(), this.password).subscribe({
      next: persisted => {
        this.unprotectedDevice.set(!persisted);
        this.accounts.identity(true).subscribe(() => {
          this.busy.set(false);
          // navigateRoot, not navigateByUrl. Router alone tells ion-router-outlet
          // nothing about stack intent, so it keeps every page it has shown — unlock
          // and login stayed mounted and painted over the app. navigateRoot resets
          // the stack, which is also what you want semantically: you must not be able
          // to go "back" into a login form still holding a password.
          void this.nav.navigateRoot(this.returnUrl(), { replaceUrl: true });
        });
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(
          err instanceof HttpErrorResponse && err.status === 401
            ? 'That username and password did not match.'
            : 'Could not reach Abofonsa BridgeCare. Check your connection and try again.',
        );
      },
    });
  }

  private returnUrl(): string {
    const target = this.route.snapshot.queryParamMap.get('returnUrl');
    // Only same-app paths: an absolute URL here would be an open redirect.
    return target?.startsWith('/') ? target : '/today';
  }
}
