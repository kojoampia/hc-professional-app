import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { IonApp, IonRouterOutlet, IonSpinner, NavController } from '@ionic/angular/standalone';

import { BootOutcome, SessionBootstrapper } from './core/auth/session-bootstrapper.service';
import { NetworkService } from './core/native/network.service';

/**
 * The app shell.
 *
 * It owns the cold-start splash and makes the one routing decision the app needs at
 * launch. Unlocking deliberately is NOT a route: as a page it made the first
 * navigation a guard redirect that then navigated again from its own ngOnInit, and
 * `ion-router-outlet` never finished either transition — every visited page stayed
 * mounted and painted over the next one. See SessionBootstrapper.
 */
@Component({
  selector: 'hpd-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonApp, IonRouterOutlet, IonSpinner],
  template: `
    <ion-app>
      @if (outcome() === null || outcome() === 'locked' || outcome() === 'offline') {
        <div class="hpd-boot">
          <h1 class="text-2xl font-bold text-hpd-primary">BridgeCare</h1>

          @switch (outcome()) {
            @case ('offline') {
              <p class="text-hpd-muted">Could not reach BridgeCare. Your session is still valid.</p>
              <button class="hpd-btn hpd-btn-primary hpd-focusable" (click)="retry()">Try again</button>
              <button class="hpd-btn hpd-btn-ghost hpd-focusable" (click)="signInInstead()">Sign in with password</button>
            }
            @case ('locked') {
              <p class="text-hpd-muted">Unlock to continue</p>
              <button class="hpd-btn hpd-btn-primary hpd-focusable" (click)="retry()">Unlock</button>
              <button class="hpd-btn hpd-btn-ghost hpd-focusable" (click)="signInInstead()">Use password</button>
            }
            @default {
              <ion-spinner name="crescent" aria-label="Restoring your session"></ion-spinner>
            }
          }
        </div>
      }

      <ion-router-outlet></ion-router-outlet>
    </ion-app>
  `,
  styles: [
    `
      /* Covers the outlet while the boot decision is being made, so the login screen
         never flashes before a session is restored. */
      .hpd-boot {
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1.5rem;
        padding: 2rem;
        text-align: center;
        background: var(--hpd-color-surface);
      }
    `,
  ],
})
export class AppComponent implements OnInit {
  private readonly bootstrapper = inject(SessionBootstrapper);
  private readonly nav = inject(NavController);
  private readonly network = inject(NetworkService);

  /** null while the decision is in flight. */
  readonly outcome = signal<BootOutcome | null>(null);

  async ngOnInit(): Promise<void> {
    await this.network.initialize();
    await this.boot();
  }

  async retry(): Promise<void> {
    this.outcome.set(null);
    await this.boot();
  }

  async signInInstead(): Promise<void> {
    this.outcome.set('needs-login');
    await this.nav.navigateRoot('/login', { replaceUrl: true });
  }

  private async boot(): Promise<void> {
    const outcome = await this.bootstrapper.restore();
    this.outcome.set(outcome);

    if (outcome === 'restored') {
      await this.nav.navigateRoot('/today', { replaceUrl: true });
    } else if (outcome === 'needs-login') {
      await this.nav.navigateRoot('/login', { replaceUrl: true });
    }
    // 'locked' and 'offline' keep the splash up with their own actions.
  }
}
