import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import {
  IonBackButton,
  IonBadge,
  IonButtons,
  IonContent,
  IonHeader,
  IonInfiniteScroll,
  IonInfiniteScrollContent,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonModal,
  IonNote,
  IonRefresher,
  IonRefresherContent,
  IonSearchbar,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';

import { LanguageService } from '../../core/i18n/language.service';
import { NetworkService } from '../../core/native/network.service';
import { AsyncBannerComponent } from '../../shared/async-banner.component';
import { EmptyRowComponent } from '../../shared/empty-row.component';
import { PatientsStore } from './patients.store';

/**
 * The clinician's patients, and one patient's record.
 *
 * <h3>A list, not a table</h3>
 * `web/` renders `hpd-data-table` with sortable columns and a pagination footer. At 390px a table is
 * the clearest "this is a ported desktop app" tell, so this is `ion-list` with `ion-searchbar`, an
 * `ion-segment` for the filters, and `ion-infinite-scroll` — which is what the `X-Total-Count`
 * header exists for, and why pagination controls disappear entirely.
 *
 * <h3>Read-only, and it says so</h3>
 * Filing an activity or a report is Phase 6, behind the offline write queue. Rather than hide the
 * absence, the record says plainly that notes cannot be filed here yet — a clinician who expects to
 * and finds no button will assume the app is broken.
 *
 * <h3>Two template traps worth knowing</h3>
 * The record branch is a nested `if` inside an `else` rather than an `else if` with an `as` alias:
 * the alias only binds on the leading `if`, so written the other way every reference to it fails to
 * compile. And an HTML comment inside the template must not mention a control-flow keyword with its
 * `at` sigil — the parser reads it as a real block and the template stops compiling, with an error
 * pointing at the comment. Both cost a build here; neither is obvious from the message.
 *
 * <h3>What survives with no signal</h3>
 * The first page and every record the clinician has opened. Not pages two onward: nobody needs page
 * seven of a patient list in a basement, and pretending otherwise would mean bending the cache's
 * whole-collection contract for something no one asked for.
 */
@Component({
  selector: 'hpd-patients',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    TranslateModule,
    AsyncBannerComponent,
    EmptyRowComponent,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    IonRefresher,
    IonRefresherContent,
    IonSearchbar,
    IonSegment,
    IonSegmentButton,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonBadge,
    IonModal,
    IonSpinner,
    IonInfiniteScroll,
    IonInfiniteScrollContent,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/today"></ion-back-button>
        </ion-buttons>
        <ion-title>{{ 'patients.title' | translate }}</ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar
          [placeholder]="'patients.search' | translate"
          [debounce]="300"
          (ionInput)="search($any($event).detail.value)"
          data-test="patient-search"
        ></ion-searchbar>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="pullToRefresh($event)">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>

      <div class="px-4 py-4 flex flex-col gap-4">
        <hpd-async-banner [status]="store.status()" [fetchedAt]="store.fetchedAt()" savedDataKey="patients.savedData"></hpd-async-banner>

        <ion-segment [value]="filter()" (ionChange)="applyFilter($any($event).detail.value)" data-test="patient-filter">
          <ion-segment-button value="all">{{ 'patients.filterAll' | translate }}</ion-segment-button>
          <ion-segment-button value="female">{{ 'patients.filterFemale' | translate }}</ion-segment-button>
          <ion-segment-button value="male">{{ 'patients.filterMale' | translate }}</ion-segment-button>
          <ion-segment-button value="children">{{ 'patients.filterChildren' | translate }}</ion-segment-button>
        </ion-segment>

        <ion-list [inset]="true">
          @for (patient of store.rows(); track patient.id) {
            <ion-item button (click)="open(patient.id)" [attr.data-test]="'patient-' + patient.id">
              <ion-label>
                <h3>{{ patient.patientName }}</h3>
                <p>
                  @if (patient.lastActivityAt) {
                    {{ 'patients.lastSeen' | translate }}
                    {{ patient.lastActivityAt | date: 'mediumDate' : undefined : locale() }}
                  } @else {
                    {{ 'patients.neverSeen' | translate }}
                  }
                </p>
              </ion-label>
              @if (patient.isChild) {
                <ion-badge slot="end" color="gold">{{ 'patients.child' | translate }}</ion-badge>
              }
            </ion-item>
          } @empty {
            <hpd-empty-row
              [status]="store.status()"
              [emptyKey]="hasFilters() ? 'patients.empty' : 'patients.emptyNone'"
              failedKey="patients.loadFailed"
            ></hpd-empty-row>
          }
        </ion-list>

        <!-- Pagination controls do not exist on a phone; this is what X-Total-Count is for. -->
        <ion-infinite-scroll [disabled]="!store.hasMore()" (ionInfinite)="loadMore($any($event))">
          <ion-infinite-scroll-content [loadingText]="'patients.loadingMore' | translate"></ion-infinite-scroll-content>
        </ion-infinite-scroll>
      </div>

      <!-- Full screen, not a sheet — the house rule, measured on device in MOB7/MOB8. -->
      <ion-modal [isOpen]="store.record() !== null || store.recordLoading() || store.recordFailed()" (didDismiss)="close()">
        <ng-template>
          <ion-header>
            <ion-toolbar>
              <ion-title>{{ store.record()?.patientName ?? ('patients.record' | translate) }}</ion-title>
              <ion-buttons slot="end">
                <button class="hpd-btn hpd-btn-ghost hpd-focusable" (click)="close()">{{ 'patients.close' | translate }}</button>
              </ion-buttons>
            </ion-toolbar>
          </ion-header>
          <ion-content class="ion-padding">
            @if (store.recordLoading()) {
              <div class="flex justify-center py-8"><ion-spinner name="crescent"></ion-spinner></div>
            } @else if (store.recordFailed()) {
              <p class="rounded-hpd-sm bg-hpd-danger-tint px-3 py-2 text-hpd-danger" role="alert">
                {{ 'patients.recordFailed' | translate }}
              </p>
            } @else {
              @if (store.record(); as record) {
                @if (!network.connected()) {
                  <p class="mb-3 rounded-hpd-sm bg-hpd-warning-tint px-3 py-2 text-hpd-warning" role="status">
                    {{ 'patients.recordOffline' | translate }}
                  </p>
                }

                <ion-list [inset]="true">
                  <ion-list-header>{{ 'patients.contact' | translate }}</ion-list-header>
                  <ion-item>
                    <ion-label>
                      <p>{{ 'patients.dateOfBirth' | translate }}</p>
                      <h3>{{ record.dateOfBirth ? (record.dateOfBirth | date: 'mediumDate' : undefined : locale()) : '—' }}</h3>
                    </ion-label>
                  </ion-item>
                  <ion-item>
                    <ion-label>
                      <p>{{ 'patients.phone' | translate }}</p>
                      <h3>{{ record.phone ?? '—' }}</h3>
                    </ion-label>
                  </ion-item>
                  @if (record.emergencyContact; as contact) {
                    <ion-item>
                      <ion-label>
                        <p>{{ 'patients.emergencyContact' | translate }}</p>
                        <h3>{{ contact.name }}</h3>
                      </ion-label>
                    </ion-item>
                  }
                </ion-list>

                <ion-list [inset]="true">
                  <ion-list-header>{{ 'patients.cases' | translate }}</ion-list-header>
                  @for (item of record.cases; track item.id) {
                    <ion-item>
                      <ion-label>
                        <h3>{{ item.brief }}</h3>
                        <p>{{ item.openedAt | date: 'mediumDate' : undefined : locale() }} · {{ item.status }}</p>
                      </ion-label>
                    </ion-item>
                  } @empty {
                    <ion-item lines="none"
                      ><ion-note>{{ 'patients.noCases' | translate }}</ion-note></ion-item
                    >
                  }
                </ion-list>

                <ion-list [inset]="true">
                  <ion-list-header>{{ 'patients.activity' | translate }}</ion-list-header>
                  @for (item of record.activities; track item.id) {
                    <ion-item>
                      <ion-label class="ion-text-wrap">
                        <h3>{{ item.label }}</h3>
                        <p>{{ item.occurredAt | date: 'medium' : undefined : locale() }}</p>
                        @if (item.description) {
                          <p class="text-hpd-muted">{{ item.description }}</p>
                        }
                      </ion-label>
                    </ion-item>
                  } @empty {
                    <ion-item lines="none"
                      ><ion-note>{{ 'patients.noActivity' | translate }}</ion-note></ion-item
                    >
                  }
                </ion-list>

                <ion-list [inset]="true">
                  <ion-list-header>{{ 'patients.reports' | translate }}</ion-list-header>
                  @for (item of record.reports; track item.id) {
                    <ion-item>
                      <ion-label>
                        <h3>{{ item.label }}</h3>
                        <p>{{ item.occurredAt | date: 'mediumDate' : undefined : locale() }} · {{ item.reportType }}</p>
                      </ion-label>
                    </ion-item>
                  } @empty {
                    <ion-item lines="none"
                      ><ion-note>{{ 'patients.noReports' | translate }}</ion-note></ion-item
                    >
                  }
                </ion-list>

                <!-- Said rather than hidden: a clinician who expects to file a note and finds no
                   button will assume the app is broken. -->
                <p class="px-4 py-2 text-hpd-muted">{{ 'patients.readOnly' | translate }}</p>
              }
            }
          </ion-content>
        </ng-template>
      </ion-modal>
    </ion-content>
  `,
})
export class PatientsPage implements OnInit {
  readonly store = inject(PatientsStore);
  readonly network = inject(NetworkService);
  private readonly language = inject(LanguageService);

  /** DatePipe formats through LOCALE_ID, which ngx-translate does not touch — pass it explicitly. */
  readonly locale = this.language.current;

  readonly filter = signal('all');

  readonly hasFilters = computed(() => {
    const { query, sex, childrenOnly } = this.store.filters();
    return Boolean(query) || Boolean(sex) || childrenOnly;
  });

  async ngOnInit(): Promise<void> {
    await this.store.refresh();
  }

  async search(value: string | null | undefined): Promise<void> {
    await this.store.applyFilters({ query: value ?? '' });
  }

  async applyFilter(value: string): Promise<void> {
    this.filter.set(value);
    await this.store.applyFilters({
      sex: value === 'female' || value === 'male' ? value : null,
      childrenOnly: value === 'children',
    });
  }

  async open(patientId: string): Promise<void> {
    await this.store.openRecord(patientId);
  }

  close(): void {
    this.store.closeRecord();
  }

  async loadMore(event: Event): Promise<void> {
    await this.store.loadMore();
    (event as CustomEvent).detail?.complete?.();
  }

  async pullToRefresh(event: Event): Promise<void> {
    await this.store.refresh();
    (event as CustomEvent).detail?.complete?.();
  }
}
