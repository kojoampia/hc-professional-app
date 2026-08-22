import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';

import { AccountApiService, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../core/api/account-api.service';

/**
 * Request a reset key, and use one.
 *
 * <h3>Why this is a component and not part of the login page</h3>
 * It lives inside an `ion-modal`, and Ionic renders modal content into an overlay — in jsdom the
 * `ng-template` is simply never instantiated. A four-locale render check written against the login
 * page therefore walks straight past every string here and passes. These are auth surfaces reached
 * by someone who cannot get in, which is the worst possible moment for a screen to be in the wrong
 * language, so they need a spec that can actually see them. Standing on its own is what makes that
 * possible.
 *
 * <h3>Both steps on one screen, deliberately</h3>
 * The reset email opens a **browser**, not this app: `AndroidManifest` carries only the LAUNCHER
 * intent filter and there is no `associatedDomains` entitlement, so no tapped link can come back
 * here. The clinician reads the key elsewhere and returns to paste it — which means step two has to
 * be reachable without having just completed step one, and the copy has to say so rather than
 * leaving someone waiting for a redirect that will never arrive.
 *
 * <h3>What the messages can and cannot claim</h3>
 * `/reset-password/init` answers 200 whether or not the address exists, so nobody can use it to
 * discover which clinicians have accounts. So this says *"if that address is registered"* and never
 * *"sent"* — the latter is a claim this client has no way to support.
 *
 * <p>`/reset-password/finish` answers 400 for a password outside the length bound and 500 for an
 * unknown key, neither carrying anything a client can branch on. Length is therefore checked before
 * sending, so anything the server refuses afterwards is reported as a bad or expired key — which is
 * what it will be.
 */
@Component({
  selector: 'hpd-password-reset',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule, FormsModule],
  template: `
    <div class="px-6 py-8">
      <h2 class="text-hpd-primary mb-2 text-xl font-bold">{{ 'auth.resetTitle' | translate }}</h2>
      <p class="text-hpd-muted mb-4">{{ 'auth.resetIntro' | translate }}</p>

      @if (message(); as text) {
        <p
          class="rounded-hpd-sm mb-4 px-4 py-3"
          [class]="failed() ? 'bg-hpd-danger-tint text-hpd-danger' : 'bg-hpd-success-tint text-hpd-success'"
          [attr.role]="failed() ? 'alert' : 'status'"
          data-test="reset-message"
        >
          {{ text | translate }}
        </p>
      }

      <label class="hpd-label" for="reset-email">{{ 'auth.email' | translate }}</label>
      <input
        id="reset-email"
        name="resetEmail"
        class="hpd-input mb-4"
        type="email"
        autocapitalize="none"
        autocorrect="off"
        [(ngModel)]="email"
        data-test="reset-email"
      />
      <button class="hpd-btn hpd-btn-primary hpd-btn-block hpd-focusable" (click)="request()" data-test="request-reset">
        {{ 'auth.resetSend' | translate }}
      </button>

      <hr class="border-hpd-border my-6" />

      <h3 class="mb-2 font-bold">{{ 'auth.resetFinishTitle' | translate }}</h3>
      <p class="text-hpd-muted mb-4">{{ 'auth.resetFinishIntro' | translate }}</p>

      <label class="hpd-label" for="reset-key">{{ 'auth.resetKey' | translate }}</label>
      <input id="reset-key" name="resetKey" class="hpd-input mb-4" autocapitalize="none" [(ngModel)]="key" data-test="reset-key" />

      <label class="hpd-label" for="reset-new">{{ 'auth.newPassword' | translate }}</label>
      <input
        id="reset-new"
        name="resetNew"
        class="hpd-input mb-4"
        type="password"
        autocomplete="new-password"
        [(ngModel)]="password"
        data-test="reset-password"
      />

      <button class="hpd-btn hpd-btn-primary hpd-btn-block hpd-focusable" (click)="finish()" data-test="finish-reset">
        {{ 'auth.resetFinish' | translate }}
      </button>

      <button class="hpd-btn hpd-btn-ghost hpd-btn-block hpd-focusable mt-4" (click)="closed.emit()" data-test="reset-close">
        {{ 'auth.resetClose' | translate }}
      </button>
    </div>
  `,
})
export class PasswordResetComponent {
  private readonly api = inject(AccountApiService);

  readonly closed = output<void>();

  email = '';
  key = '';
  password = '';

  readonly failed = signal(false);
  readonly message = signal<string | null>(null);

  /** Called by the host when the modal opens, so a second visit does not show the first's outcome. */
  reset(email: string): void {
    // Seeded from the sign-in field: someone who has just failed to sign in usually typed their
    // address there, and re-typing it is the friction that sends people to the web portal instead.
    this.email = email;
    this.key = '';
    this.password = '';
    this.message.set(null);
    this.failed.set(false);
  }

  request(): void {
    this.message.set(null);
    if (!this.email.trim()) {
      this.failed.set(true);
      this.message.set('auth.resetNeedsEmail');
      return;
    }
    this.api.requestPasswordReset(this.email.trim()).subscribe({
      next: () => {
        this.failed.set(false);
        this.message.set('auth.resetRequested');
      },
      // Only a transport failure reaches here — an unknown address is a 200 by design.
      error: () => {
        this.failed.set(true);
        this.message.set('auth.unreachable');
      },
    });
  }

  finish(): void {
    this.message.set(null);
    if (!this.key.trim()) {
      this.failed.set(true);
      this.message.set('auth.resetNeedsKey');
      return;
    }
    if (this.password.length < PASSWORD_MIN_LENGTH || this.password.length > PASSWORD_MAX_LENGTH) {
      this.failed.set(true);
      this.message.set('auth.passwordLength');
      return;
    }
    this.api.finishPasswordReset({ key: this.key.trim(), newPassword: this.password }).subscribe({
      next: () => {
        this.failed.set(false);
        this.message.set('auth.resetDone');
        this.key = '';
        this.password = '';
      },
      error: () => {
        this.failed.set(true);
        this.message.set('auth.resetBadKey');
      },
    });
  }
}
