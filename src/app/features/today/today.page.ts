import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, TitleCasePipe } from '@angular/common';
import {
  IonBadge,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonRefresher,
  IonRefresherContent,
  IonTitle,
  IonToolbar,
  NavController,
} from '@ionic/angular/standalone';

import { shiftWindowText } from '../../core/api/duty-roster-api.service';
import { isWorkingClinician } from '../../core/api/onboarding-api.service';
import { AccountService } from '../../core/auth/account.service';
import { NetworkService } from '../../core/native/network.service';
import { describeAge } from '../../core/offline/cached-resource';
import { TodayStore } from './today.store';

/**
 * The on-shift home screen: what am I doing now, what is next, does anyone need me,
 * and is anything about to lapse.
 *
 * Replaces `/diagnostics` as the signed-in landing route.
 */
@Component({
  selector: 'hpd-today',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    TitleCasePipe,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonRefresher,
    IonRefresherContent,
    IonCard,
    IonCardHeader,
    IonCardSubtitle,
    IonCardTitle,
    IonCardContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonBadge,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Today</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="pullToRefresh($event)">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>

      <div class="px-4 py-4 flex flex-col gap-4">
        @if (!network.connected() || store.isStale()) {
          <p class="rounded-hpd-sm bg-hpd-warning-tint px-3 py-2 text-hpd-warning" role="status">
            {{ network.connected() ? 'Showing saved data' : 'Offline — showing saved data' }} · updated {{ age() }}
          </p>
        }

        @if (needsPortal()) {
          <ion-card>
            <ion-card-header>
              <ion-card-title>Finish your application</ion-card-title>
            </ion-card-header>
            <ion-card-content>
              <p class="mb-3">Your application is not active yet, so there is nothing rostered.</p>
              <p class="text-hpd-muted">Continue at professional.abofonsa.com to complete it.</p>
            </ion-card-content>
          </ion-card>
        }

        <!-- Current or next shift -->
        <ion-card>
          <ion-card-header>
            <ion-card-subtitle>{{ shiftHeading() }}</ion-card-subtitle>
            <ion-card-title>{{ shiftTitle() }}</ion-card-title>
          </ion-card-header>
          @if (currentAssignment(); as assignment) {
            <ion-card-content>
              {{ assignment.name }} · {{ assignment.duty }}
              @if (windowText(assignment.shift); as window) {
                <span class="text-hpd-muted"> · {{ window }}</span>
              }
            </ion-card-content>
          }
        </ion-card>

        <!-- Anything needing attention -->
        @if (unread() > 0 || expiring().length) {
          <ion-list [inset]="true">
            <ion-list-header><ion-label>Needs attention</ion-label></ion-list-header>
            @if (unread() > 0) {
              <ion-item button="true" (click)="openMessages()">
                <ion-label>Unread messages</ion-label>
                <ion-badge slot="end" color="gold">{{ unread() }}</ion-badge>
              </ion-item>
            }
            @for (entry of expiring(); track entry.document.id) {
              <ion-item button="true" (click)="openDocuments()">
                <ion-label>
                  {{ entry.document.otherLabel ?? 'Licence' }}
                  <p class="text-hpd-muted">{{ entry.lapsed ? 'Expired' : 'Expires' }} {{ entry.document.expiryDate }}</p>
                </ion-label>
                <ion-badge slot="end" [color]="entry.lapsed ? 'danger' : 'warning'">
                  {{ entry.lapsed ? 'lapsed' : entry.daysRemaining + ' d' }}
                </ion-badge>
              </ion-item>
            }
          </ion-list>
        }

        <!-- The next seven days -->
        <ion-list [inset]="true">
          <ion-list-header><ion-label>Next 7 days</ion-label></ion-list-header>
          @for (assignment of upcoming(); track assignment.id ?? assignment.date + assignment.shift) {
            <ion-item>
              <ion-label>
                {{ assignment.date | date: 'EEE d MMM' }}
                <p class="text-hpd-muted">{{ assignment.name }} · {{ assignment.duty }}</p>
              </ion-label>
              <ion-note slot="end">
                {{ assignment.shift | titlecase }}
                @if (windowText(assignment.shift); as window) {
                  <span class="block text-hpd-subtle">{{ window }}</span>
                }
              </ion-note>
            </ion-item>
          } @empty {
            <ion-item lines="none">
              <ion-label class="text-hpd-muted">
                {{ store.roster.status() === 'error' ? 'Could not load your roster.' : 'Nothing rostered in the next 7 days.' }}
              </ion-label>
            </ion-item>
          }
        </ion-list>
      </div>
    </ion-content>
  `,
})
export class TodayPage implements OnInit {
  readonly store = inject(TodayStore);
  readonly network = inject(NetworkService);
  private readonly accounts = inject(AccountService);
  private readonly nav = inject(NavController);

  readonly upcoming = this.store.upcoming;
  readonly expiring = this.store.expiringDocuments;
  readonly unread = computed(() => this.store.unread.value() ?? 0);

  private readonly nowTick = signal(Date.now());
  readonly age = computed(() => describeAge(this.store.oldestFetchedAt(), this.nowTick()));

  /** True only once we actually know the status — an unknown status must not nag. */
  readonly needsPortal = computed(() => {
    const application = this.store.application.value();
    return application !== null && !isWorkingClinician(application.status);
  });

  /** Comes from the same selection as the headline — see TodayStore.featuredAssignment. */
  readonly currentAssignment = this.store.featuredAssignment;

  readonly shiftHeading = computed(() => {
    const label = this.store.shiftLabel();
    if (!label) {
      return 'No shift assigned';
    }
    return label.kind === 'active' || label.kind === 'flexible' ? 'On duty' : 'Next shift';
  });

  readonly shiftTitle = computed(() => {
    const label = this.store.shiftLabel();
    if (!label) {
      const name = this.accounts.account()?.firstName;
      return name ? `Nothing today, ${name}` : 'Nothing today';
    }
    switch (label.kind) {
      case 'active':
        return `Until ${label.time}`;
      case 'flexible':
        return 'Flexible hours today';
      case 'nextFlexible':
        return `Flexible on ${label.date}`;
      default:
        return `${label.date} at ${label.time}`;
    }
  });

  windowText = shiftWindowText;

  async ngOnInit(): Promise<void> {
    await this.store.refresh();
    this.nowTick.set(Date.now());
  }

  async pullToRefresh(event: Event): Promise<void> {
    await this.store.refresh();
    this.nowTick.set(Date.now());
    (event as CustomEvent).detail?.complete?.();
  }

  openMessages(): void {
    void this.nav.navigateForward('/messages');
  }

  openDocuments(): void {
    // An expiring licence is actionable: the point of surfacing it is that the
    // clinician can photograph the renewal there and then.
    void this.nav.navigateForward('/documents');
  }
}
