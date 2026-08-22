import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import {
  IonBackButton,
  IonBadge,
  IonButtons,
  IonContent,
  IonDatetime,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonModal,
  IonNote,
  IonRefresher,
  IonRefresherContent,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';

import { AbsenceType } from '../../core/api/absence-api.service';
import { isoDate, shiftWindowText } from '../../core/api/duty-roster-api.service';
import { LanguageService } from '../../core/i18n/language.service';
import { RelativeTime } from '../../core/i18n/relative-time.service';
import { AsyncBannerComponent } from '../../shared/async-banner.component';
import { EmptyRowComponent } from '../../shared/empty-row.component';
import { NetworkService } from '../../core/native/network.service';
import { RosterStore } from './roster.store';

/**
 * The roster calendar, and the clinician's own time off.
 *
 * <h3>Why a calendar control and not a grid</h3>
 * `web/` renders four hand-built grids — year, month, week, day. The year grid alone draws 365
 * cells, which at 390px is a scroll trap rather than a view, and the week duplicates the month at
 * lower density. `ion-datetime` gives the month view natively, marks days through
 * `highlightedDates`, and localises its month and weekday names through `LOCALE_ID` for free — which
 * matters here, because ngx-translate does not touch date formatting and getting that wrong is how
 * a German app ends up with English month names beside translated copy.
 *
 * <h3>The day view always costs a request</h3>
 * `GET /duty-roster/day/{date}` refreshes visit snapshots as it reads. It is not cached, not
 * prefetched, and it fails visibly rather than showing something stale — at a doorstep, out-of-date
 * customer details are worse than an honest "could not load". Everything else on this screen comes
 * from the offline cache and renders with no signal.
 *
 * <h3>Requesting leave is one of two writes a clinician has here</h3>
 * Rounds and visits are assigned by administrators. Asking for time off and withdrawing that
 * request are the only things a clinician may change, which is why the admin round-builder and
 * approval queue from `web/` are not ported.
 */
@Component({
  selector: 'hpd-roster',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AsyncBannerComponent,
    EmptyRowComponent,
    DatePipe,
    TitleCasePipe,
    FormsModule,
    TranslateModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    IonRefresher,
    IonRefresherContent,
    IonDatetime,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonBadge,
    IonModal,
    IonSelect,
    IonSelectOption,
    IonSpinner,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/today"></ion-back-button>
        </ion-buttons>
        <ion-title>{{ 'roster.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-refresher slot="fixed" (ionRefresh)="pullToRefresh($event)">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>

      <div class="flex flex-col gap-4">
        <hpd-async-banner
          [status]="store.isStale() ? 'stale' : 'fresh'"
          [fetchedAt]="store.oldestFetchedAt()"
          savedDataKey="roster.savedData"
        ></hpd-async-banner>

        <!-- The month view. Marks come from the year summary, which is cached. -->
        <ion-datetime
          presentation="date"
          [locale]="locale()"
          [highlightedDates]="marks()"
          [value]="store.selectedDate()"
          (ionChange)="openDay($any($event).detail.value)"
          data-test="roster-calendar"
        ></ion-datetime>

        <ion-list inset="true">
          <ion-list-header>{{ 'absence.title' | translate }}</ion-list-header>
          @for (absence of store.upcomingAbsences(); track absence.id) {
            <ion-item>
              <ion-label>
                <h3>{{ absenceTypeKey(absence.type) | translate }}</h3>
                <p>
                  {{ absence.fromDate | date: 'mediumDate' : undefined : locale() }} –
                  {{ absence.toDate | date: 'mediumDate' : undefined : locale() }}
                </p>
              </ion-label>
              <ion-badge slot="end" [color]="absence.status === 'APPROVED' ? 'success' : 'warning'">
                {{ (absence.status === 'APPROVED' ? 'absence.statusApproved' : 'absence.statusRequested') | translate }}
              </ion-badge>
            </ion-item>
          } @empty {
            <hpd-empty-row [status]="store.absences.status()" emptyKey="absence.none" failedKey="roster.loadFailed"></hpd-empty-row>
          }
          <ion-item lines="none">
            <button class="hpd-btn hpd-btn-ghost hpd-btn-block hpd-focusable" (click)="openRequest()" data-test="request-absence">
              {{ 'absence.request' | translate }}
            </button>
          </ion-item>
        </ion-list>
      </div>

      <!--
        Full screen, not a sheet. Measured on device during MOB7/MOB8: at initialBreakpoint the
        wrapper stays full height and translates down, pushing the controls at the bottom out of
        reach. Same reason the messages thread and the document upload are full-screen modals.
      -->
      <ion-modal [isOpen]="store.selectedDate() !== null" (didDismiss)="store.closeDay()">
        <ng-template>
          <ion-header>
            <ion-toolbar>
              <ion-title>{{ store.selectedDate() | date: 'fullDate' : undefined : locale() }}</ion-title>
              <ion-buttons slot="end">
                <button class="hpd-btn hpd-btn-ghost hpd-focusable" (click)="store.closeDay()">
                  {{ 'roster.close' | translate }}
                </button>
              </ion-buttons>
            </ion-toolbar>
          </ion-header>
          <ion-content class="ion-padding">
            @if (store.dayLoading()) {
              <div class="flex justify-center py-8"><ion-spinner name="crescent"></ion-spinner></div>
            } @else if (store.dayFailed()) {
              <p class="rounded-hpd-sm bg-hpd-danger-tint px-3 py-2 text-hpd-danger" role="alert">
                {{ 'roster.dayLoadFailed' | translate }}
              </p>
            } @else {
              <ion-list inset="true">
                <ion-list-header>{{ 'roster.dayTitle' | translate }}</ion-list-header>
                @for (round of store.day(); track round.id ?? round.date + round.shift) {
                  <ion-item>
                    <ion-label>
                      <h3>{{ round.name }}</h3>
                      <p>
                        {{ round.shift | titlecase }}
                        @if (windowText(round.shift); as window) {
                          · {{ window }}
                        }
                        · {{ round.duty | titlecase }}
                      </p>
                      @for (visit of round.visits ?? []; track visit.id ?? visit.customerId + visit.startTime) {
                        <p class="text-hpd-muted">
                          {{ visit.startTime }}–{{ visit.endTime }} ·
                          {{ visit.customerName || ('roster.unnamedCustomer' | translate) }}
                        </p>
                      } @empty {
                        <p class="text-hpd-muted">{{ 'roster.noVisits' | translate }}</p>
                      }
                    </ion-label>
                  </ion-item>
                } @empty {
                  <ion-item lines="none">
                    <ion-label class="text-hpd-muted">{{ 'roster.dayEmpty' | translate }}</ion-label>
                  </ion-item>
                }
              </ion-list>
            }
          </ion-content>
        </ng-template>
      </ion-modal>

      <ion-modal [isOpen]="requesting()" (didDismiss)="requesting.set(false)">
        <ng-template>
          <ion-header>
            <ion-toolbar>
              <ion-title>{{ 'absence.request' | translate }}</ion-title>
              <ion-buttons slot="end">
                <button class="hpd-btn hpd-btn-ghost hpd-focusable" (click)="requesting.set(false)">
                  {{ 'roster.close' | translate }}
                </button>
              </ion-buttons>
            </ion-toolbar>
          </ion-header>
          <ion-content class="ion-padding">
            @if (requestError(); as error) {
              <p class="mb-3 rounded-hpd-sm bg-hpd-danger-tint px-3 py-2 text-hpd-danger" role="alert">{{ error | translate }}</p>
            }
            <ion-list>
              <ion-item>
                <ion-label position="stacked">{{ 'absence.from' | translate }}</ion-label>
                <input class="hpd-input" type="date" [(ngModel)]="fromDate" data-test="absence-from" />
              </ion-item>
              <ion-item>
                <ion-label position="stacked">{{ 'absence.to' | translate }}</ion-label>
                <input class="hpd-input" type="date" [(ngModel)]="toDate" data-test="absence-to" />
              </ion-item>
              <ion-item>
                <ion-select label="{{ 'absence.type' | translate }}" labelPlacement="stacked" [(ngModel)]="type" data-test="absence-type">
                  <ion-select-option value="HOLIDAY">{{ 'absence.typeHoliday' | translate }}</ion-select-option>
                  <ion-select-option value="SICK">{{ 'absence.typeSick' | translate }}</ion-select-option>
                  <ion-select-option value="OTHER">{{ 'absence.typeOther' | translate }}</ion-select-option>
                </ion-select>
              </ion-item>
              <ion-item lines="none">
                <button
                  class="hpd-btn hpd-btn-primary hpd-btn-block hpd-focusable"
                  [disabled]="submitting()"
                  (click)="submit()"
                  data-test="absence-submit"
                >
                  @if (submitting()) {
                    <ion-spinner name="crescent"></ion-spinner>
                  } @else {
                    {{ 'absence.submit' | translate }}
                  }
                </button>
              </ion-item>
            </ion-list>
          </ion-content>
        </ng-template>
      </ion-modal>
    </ion-content>
  `,
})
export class RosterPage implements OnInit {
  readonly store = inject(RosterStore);
  readonly network = inject(NetworkService);
  private readonly relativeTime = inject(RelativeTime);
  private readonly language = inject(LanguageService);

  /** DatePipe formats through LOCALE_ID, which ngx-translate does not touch — pass it explicitly. */
  readonly locale = this.language.current;

  readonly requesting = signal(false);
  readonly submitting = signal(false);
  readonly requestError = signal<string | null>(null);

  fromDate = isoDate(new Date());
  toDate = isoDate(new Date());
  type: AbsenceType = 'HOLIDAY';

  /**
   * Days to mark on the calendar.
   *
   * <p>Leave is drawn over duty rather than instead of it: a day that is both rostered and asked
   * off is the one worth noticing, and it is precisely what the server's 409 refuses to approve.
   */
  readonly marks = computed(() => {
    const absent = new Set(this.store.absentDates());
    const marks = this.store
      .workedDates()
      .filter(date => !absent.has(date))
      .map(date => ({ date, textColor: '#ffffff', backgroundColor: '#0d3058' }));
    // Gold, with dark ink — never white on gold, which is 2.74:1 and fails AA.
    return [...marks, ...[...absent].map(date => ({ date, textColor: '#3a2a08', backgroundColor: '#c59437' }))];
  });

  async ngOnInit(): Promise<void> {
    await this.store.refresh();
  }

  windowText(shift: Parameters<typeof shiftWindowText>[0]): string | null {
    return shiftWindowText(shift);
  }

  absenceTypeKey(type: AbsenceType): string {
    return type === 'HOLIDAY' ? 'absence.typeHoliday' : type === 'SICK' ? 'absence.typeSick' : 'absence.typeOther';
  }

  async openDay(value: string | null): Promise<void> {
    if (!value) {
      return;
    }
    // ion-datetime hands back a full ISO timestamp; the endpoint takes a date.
    await this.store.openDay(value.slice(0, 10));
  }

  openRequest(): void {
    this.requestError.set(null);
    this.requesting.set(true);
  }

  async submit(): Promise<void> {
    if (this.toDate < this.fromDate) {
      this.requestError.set('absence.datesInvalid');
      return;
    }
    if (!this.network.connected()) {
      // No offline write queue yet, so a mutation must fail visibly rather than vanish into a
      // synthetic success. Stated before the attempt so the clinician is not left guessing.
      this.requestError.set('absence.offline');
      return;
    }
    this.submitting.set(true);
    this.requestError.set(null);
    try {
      await this.store.requestAbsence({ fromDate: this.fromDate, toDate: this.toDate, type: this.type });
      this.requesting.set(false);
    } catch {
      this.requestError.set('absence.requestFailed');
    } finally {
      this.submitting.set(false);
    }
  }

  async pullToRefresh(event: Event): Promise<void> {
    await this.store.refresh();
    (event as CustomEvent).detail?.complete?.();
  }
}
