import { Component, signal } from '@angular/core';
import {
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonChip,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonModal,
  IonNote,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';

/**
 * MOB2 deliverable: every BridgeCare surface on one screen, so the port can be
 * compared against `web/` and against the demo mockup at the workspace root
 * without hunting through the app.
 *
 * It also doubles as the manual dark-mode check — put the OS in dark mode and
 * this page must render identically. If anything inverts, the Ionic dark palette
 * import has come back (hpd-theme.spec.ts guards the import itself).
 *
 * Reachable at /theme. Not linked from the app shell; it is a development
 * surface, and MOB11 decides whether to strip it from production builds.
 */
@Component({
  selector: 'hpd-theme-gallery',
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardSubtitle,
    IonCardContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonBadge,
    IonChip,
    IonButton,
    IonInput,
    IonModal,
  ],
  styles: [
    `
      .swatch-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
        gap: 8px;
      }
      .swatch {
        border-radius: var(--hpd-r-sm);
        border: 1px solid var(--hpd-color-border);
        padding: 10px 8px;
        font-size: 11px;
        font-weight: 700;
        min-height: 56px;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Design system</ion-title>
        <ion-buttons slot="end">
          <ion-button color="gold" fill="solid" size="small" (click)="sheetOpen.set(true)">Sheet</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <div class="px-4 py-4 flex flex-col gap-6">
        <!-- Shared .hpd-btn classes, copied verbatim from web/ -->
        <section>
          <p class="hpd-label">Shared button classes (.hpd-btn)</p>
          <div class="flex flex-wrap gap-2">
            <button class="hpd-btn hpd-btn-primary hpd-focusable">Primary</button>
            <button class="hpd-btn hpd-btn-gold hpd-focusable">Gold</button>
            <button class="hpd-btn hpd-btn-ghost hpd-focusable">Ghost</button>
            <button class="hpd-btn hpd-btn-danger hpd-focusable">Danger</button>
            <button class="hpd-btn hpd-btn-primary" disabled>Disabled</button>
          </div>
          <button class="hpd-btn hpd-btn-primary hpd-btn-block mt-2">Full width (mobile-only)</button>
        </section>

        <!-- Ionic components, themed through variables.css -->
        <section>
          <p class="hpd-label">Ionic buttons (themed via --ion-color-*)</p>
          <div class="flex flex-wrap gap-2">
            <ion-button>Primary</ion-button>
            <ion-button color="gold">Gold</ion-button>
            <ion-button fill="outline">Outline</ion-button>
            <ion-button color="danger">Danger</ion-button>
          </div>
        </section>

        <section>
          <p class="hpd-label">Status</p>
          <div class="flex flex-wrap gap-2 items-center">
            <ion-badge color="success">Verified</ion-badge>
            <ion-badge color="warning">Expiring</ion-badge>
            <ion-badge color="danger">Lapsed</ion-badge>
            <ion-badge color="gold">Gold</ion-badge>
            <ion-chip>Morning 06:00–14:00</ion-chip>
          </div>
        </section>

        <section>
          <p class="hpd-label">Palette</p>
          <div class="swatch-grid">
            @for (s of swatches; track s.name) {
              <div class="swatch" [style.background]="s.value" [style.color]="s.ink">{{ s.name }}</div>
            }
          </div>
        </section>

        <ion-card>
          <ion-card-header>
            <ion-card-subtitle>Next shift</ion-card-subtitle>
            <ion-card-title>Morning · Ward B</ion-card-title>
          </ion-card-header>
          <ion-card-content> On duty until 14:00. Cards use --hpd-r radius and the navy-tinted --hpd-sh-sm shadow. </ion-card-content>
        </ion-card>

        <ion-list [inset]="true">
          <ion-list-header><ion-label>List + note</ion-label></ion-list-header>
          <ion-item>
            <ion-label>Medical licence</ion-label>
            <ion-note slot="end">Expires 2027-03-01</ion-note>
          </ion-item>
          <ion-item lines="none">
            <ion-label>Practising certificate</ion-label>
            <ion-badge slot="end" color="success">Verified</ion-badge>
          </ion-item>
        </ion-list>

        <section>
          <label class="hpd-label" for="demo-native">Native input (.hpd-input)</label>
          <input id="demo-native" class="hpd-input" placeholder="Search patients" />
          <div class="mt-3">
            <ion-input label="Ionic input" labelPlacement="stacked" fill="outline" placeholder="Ward name"></ion-input>
          </div>
        </section>

        <section>
          <p class="hpd-label">Typography — one family, Inter</p>
          <p class="text-hpd-primary-dark">Regular 400 — body copy on the page surface.</p>
          <p class="font-semibold text-hpd-primary-dark">Semibold 600 — emphasis.</p>
          <p class="font-bold text-hpd-primary">Bold 700 — navy heading tone.</p>
          <p class="text-hpd-muted">Muted — secondary information.</p>
        </section>
      </div>

      <!-- Bottom sheet: the mobile replacement for web/'s focus-trap overlay -->
      <ion-modal [isOpen]="sheetOpen()" [breakpoints]="[0, 0.5, 0.9]" [initialBreakpoint]="0.5" (ionModalDidDismiss)="sheetOpen.set(false)">
        <ng-template>
          <ion-header>
            <ion-toolbar>
              <ion-title>Bottom sheet</ion-title>
              <ion-buttons slot="end">
                <ion-button (click)="sheetOpen.set(false)">Close</ion-button>
              </ion-buttons>
            </ion-toolbar>
          </ion-header>
          <ion-content>
            <div class="px-4 py-4">
              <p class="text-hpd-muted">
                Replaces the desktop focus-trap modal. Ionic owns the focus trap, swipe-to-dismiss and backdrop; the radius comes from
                --hpd-r-lg.
              </p>
            </div>
          </ion-content>
        </ng-template>
      </ion-modal>
    </ion-content>
  `,
})
export class ThemeGalleryPage {
  readonly sheetOpen = signal(false);

  readonly swatches = [
    { name: 'navy', value: '#0d3058', ink: '#ffffff' },
    { name: 'hover', value: '#12406f', ink: '#ffffff' },
    { name: 'deep', value: '#092239', ink: '#ffffff' },
    { name: 'gold', value: '#c59437', ink: '#3a2a08' },
    { name: 'gold-br', value: '#ddb868', ink: '#3a2a08' },
    { name: 'gold-tint', value: '#fbf4e6', ink: '#16202c' },
    { name: 'cream', value: '#f7f4ee', ink: '#16202c' },
    { name: 'surface', value: '#f2f0ea', ink: '#16202c' },
    { name: 'border', value: '#e6e2d9', ink: '#16202c' },
    { name: 'success', value: '#2a7554', ink: '#ffffff' },
    { name: 'warning', value: '#96600f', ink: '#ffffff' },
    { name: 'danger', value: '#b3402f', ink: '#ffffff' },
  ];
}
