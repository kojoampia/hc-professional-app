import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonNote,
  IonRefresher,
  IonRefresherContent,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';

import { AsyncBannerComponent } from '../../shared/async-banner.component';
import { StatTileComponent } from '../../shared/stat-tile.component';
import { DashboardStore } from './dashboard.store';

/**
 * Numbers, and only numbers.
 *
 * <h3>What is deliberately absent</h3>
 * **No charts** (decision 7). `web/` has three plus a `chart-transforms.ts`: roughly 300 lines with
 * specs and ~80 new strings across four locales for axes and legends, unreadable at 390px, and fed
 * by an unpaginated cross-service fetch that Phase 1 existed to eliminate. **No earnings** either —
 * that data comes from `adminservice`, which is outside this workspace and has no pagination and no
 * ETag, so there is no way to add them.
 *
 * **No redirect for an incomplete applicant.** The app already makes that decision at boot, and a
 * second one here would be a second place to get it wrong.
 *
 * <h3>An absent number is a dash</h3>
 * Every tile renders `—` rather than `0` when the figure is not known. `DashboardResource` takes the
 * same position by omitting case fields entirely rather than sending zeros, and its javadoc says
 * why: a tile reading "0 urgent" is a clinical claim. The two halves fail independently, so patient
 * counts can render while case counts show dashes — and the screen says so rather than leaving three
 * dashes to be read as "no cases".
 */
@Component({
  selector: 'hpd-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslateModule,
    AsyncBannerComponent,
    StatTileComponent,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    IonNote,
    IonRefresher,
    IonRefresherContent,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/today"></ion-back-button>
        </ion-buttons>
        <ion-title>{{ 'dashboard.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="pullToRefresh($event)">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>

      <div class="flex flex-col gap-5 px-4 py-4">
        <hpd-async-banner [status]="store.status()" [fetchedAt]="store.fetchedAt()" savedDataKey="dashboard.savedData"></hpd-async-banner>

        <section>
          <h2 class="text-hpd-muted mb-2 text-sm font-bold uppercase tracking-wide">{{ 'dashboard.patients' | translate }}</h2>
          <div class="flex gap-2">
            <hpd-stat-tile labelKey="dashboard.allPatients" [value]="store.patients()"></hpd-stat-tile>
            <hpd-stat-tile labelKey="dashboard.children" [value]="store.kids()"></hpd-stat-tile>
          </div>
          <div class="mt-2 flex gap-2">
            <hpd-stat-tile labelKey="dashboard.female" [value]="store.female()"></hpd-stat-tile>
            <hpd-stat-tile labelKey="dashboard.male" [value]="store.male()"></hpd-stat-tile>
          </div>
        </section>

        <section>
          <h2 class="text-hpd-muted mb-2 text-sm font-bold uppercase tracking-wide">{{ 'dashboard.cases' | translate }}</h2>
          <div class="flex gap-2">
            <hpd-stat-tile labelKey="dashboard.openCases" [value]="store.openCases()"></hpd-stat-tile>
            <hpd-stat-tile labelKey="dashboard.urgentCases" [value]="store.urgentCases()"></hpd-stat-tile>
            <hpd-stat-tile labelKey="dashboard.closedCases" [value]="store.closedCases()"></hpd-stat-tile>
          </div>
          @if (store.casesUnavailable()) {
            <!-- Said, not left to inference. Three dashes with no explanation read as "no cases". -->
            <ion-note class="mt-2 block">{{ 'dashboard.casesUnavailable' | translate }}</ion-note>
          }
        </section>

        <ion-note>{{ 'dashboard.noCharts' | translate }}</ion-note>
      </div>
    </ion-content>
  `,
})
export class DashboardPage implements OnInit {
  readonly store = inject(DashboardStore);

  async ngOnInit(): Promise<void> {
    await this.store.refresh();
  }

  async pullToRefresh(event: Event): Promise<void> {
    await this.store.refresh();
    await (event as CustomEvent).detail.complete();
  }
}
