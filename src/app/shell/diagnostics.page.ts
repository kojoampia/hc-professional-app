import { Component, OnInit, inject, signal } from '@angular/core';

import { Capacitor } from '@capacitor/core';
import {
  IonBadge,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonTitle,
  IonToolbar,
  NavController,
} from '@ionic/angular/standalone';

import { environment } from '../../environments/environment';
import { AccountService } from '../core/auth/account.service';
import { AuthService } from '../core/auth/auth.service';
import { BiometricService } from '../core/native/biometric.service';
import { NetworkService } from '../core/native/network.service';
import { PushService } from '../core/native/push.service';
import { SecureTokenStore } from '../core/native/secure-token-store.service';
import { ShareService } from '../core/native/share.service';

interface Probe {
  label: string;
  value: string;
  ok: boolean | null;
}

/**
 * MOB1 deliverable: proves the shell boots and that each native wrapper resolves
 * on the platform it is running on. This is the screen the device smoke checklist
 * opens first, and it is what makes "launches in Chrome / emulator / simulator"
 * an observable gate rather than an assertion.
 *
 * Replaced by the Today tab in MOB6; kept reachable at /diagnostics.
 */
@Component({
  selector: 'hpd-diagnostics',
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonListHeader, IonItem, IonLabel, IonNote, IonBadge],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Abofonsa BridgeCare</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="px-4 py-2">
      <!-- MOB1 pipeline probe: real Tailwind utilities, asserted by the build check -->
      <p class="text-center font-semibold tracking-tight">Bootstrap shell</p>
      <ion-list [inset]="true">
        <ion-list-header><ion-label>Signed in</ion-label></ion-list-header>
        <ion-item>
          <ion-label>Account</ion-label>
          <ion-note slot="end">{{ accounts.account()?.login ?? 'unknown' }}</ion-note>
        </ion-item>
        <ion-item lines="none">
          <ion-label>Authorities</ion-label>
          <ion-note slot="end">{{ accounts.account()?.authorities?.join(', ') ?? '—' }}</ion-note>
        </ion-item>
      </ion-list>

      <button class="hpd-btn hpd-btn-ghost hpd-btn-block hpd-focusable mb-4" (click)="signOut()">Sign out</button>

      <ion-list [inset]="true">
        <ion-list-header><ion-label>Build</ion-label></ion-list-header>
        @for (row of build(); track row.label) {
          <ion-item>
            <ion-label>{{ row.label }}</ion-label>
            <ion-note slot="end">{{ row.value }}</ion-note>
          </ion-item>
        }
      </ion-list>

      <ion-list [inset]="true">
        <ion-list-header><ion-label>Native capabilities</ion-label></ion-list-header>
        @for (row of probes(); track row.label) {
          <ion-item>
            <ion-label>{{ row.label }}</ion-label>
            @if (row.ok === null) {
              <ion-badge slot="end" color="medium">{{ row.value }}</ion-badge>
            } @else if (row.ok) {
              <ion-badge slot="end" color="success">{{ row.value }}</ion-badge>
            } @else {
              <ion-badge slot="end" color="warning">{{ row.value }}</ion-badge>
            }
          </ion-item>
        }
      </ion-list>
    </ion-content>
  `,
})
export class DiagnosticsPage implements OnInit {
  private readonly biometrics = inject(BiometricService);
  private readonly network = inject(NetworkService);
  private readonly push = inject(PushService);
  private readonly tokens = inject(SecureTokenStore);
  private readonly share = inject(ShareService);
  private readonly auth = inject(AuthService);
  private readonly nav = inject(NavController);
  readonly accounts = inject(AccountService);

  readonly build = signal<Probe[]>([
    { label: 'Platform', value: Capacitor.getPlatform(), ok: null },
    { label: 'Native', value: String(Capacitor.isNativePlatform()), ok: null },
    { label: 'API base', value: environment.apiBaseUrl, ok: null },
    { label: 'Mode', value: environment.production ? 'production' : 'development', ok: null },
  ]);

  readonly probes = signal<Probe[]>([]);

  async ngOnInit(): Promise<void> {
    const results: Probe[] = [];

    await this.network.initialize();
    results.push({ label: 'Network', value: this.network.connected() ? 'online' : 'offline', ok: this.network.connected() });

    try {
      const protection = await this.biometrics.protectionLevel();
      results.push({ label: 'Device protection', value: protection, ok: protection !== 'none' });
    } catch {
      results.push({ label: 'Device protection', value: 'unavailable', ok: false });
    }

    results.push({ label: 'Push', value: this.push.supported ? 'supported' : 'web (unsupported)', ok: this.push.supported });

    try {
      const stored = await this.tokens.hasRefreshToken();
      results.push({ label: 'Secure store', value: stored ? 'has token' : 'reachable, empty', ok: true });
    } catch {
      results.push({ label: 'Secure store', value: 'unreachable', ok: false });
    }

    try {
      const canShare = await this.share.canShare();
      results.push({ label: 'Share sheet', value: canShare ? 'available' : 'unavailable', ok: canShare });
    } catch {
      results.push({ label: 'Share sheet', value: 'unavailable', ok: false });
    }

    this.probes.set(results);
  }

  signOut(): void {
    this.auth.logout('user').subscribe(() => {
      this.accounts.clear();
      void this.nav.navigateRoot(['/login'], { replaceUrl: true });
    });
  }
}
