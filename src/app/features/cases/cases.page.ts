import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
  IonModal,
  IonNote,
  IonRefresher,
  IonRefresherContent,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';

import { AccountService } from '../../core/auth/account.service';
import { hasClinicalPermission } from '../../core/auth/clinical-permissions';
import { LanguageService } from '../../core/i18n/language.service';
import { AsyncBannerComponent } from '../../shared/async-banner.component';
import { EmptyRowComponent } from '../../shared/empty-row.component';
import { PendingChipComponent } from '../../shared/pending-chip.component';
import { StatTileComponent } from '../../shared/stat-tile.component';
import { CaseSummaryDto } from '../../core/api/case-api.service';
import { CasesStore } from './cases.store';

/**
 * The clinician's case queue, and one case in detail.
 *
 * <h3>Two segments, not a dropdown</h3>
 * Status is the filter clinicians actually use, and it has four values. An `ion-select` would hide
 * the current one behind a tap; a segment shows it and switches in one. It is sent to the server —
 * filtering a page of twenty in the browser would silently narrow a result set the server had
 * already paged.
 *
 * <h3>The tiles count what is loaded, and say nothing when nothing is</h3>
 * `hpd-stat-tile` renders an em dash for a null value. "0 urgent" is a claim about a caseload, and
 * making it because a request failed is worse than admitting the number is not known — the same
 * position `DashboardResource` takes by omitting fields it cannot answer.
 *
 * <h3>There is no archive button, and that is a decision</h3>
 * `web/` has one; it is client-side only — its own comment says *no archive endpoint specced* — so
 * the case reappears on the next load and on every other client. Shipping a button that quietly
 * lies about a clinical record is worse than not shipping it, so this says plainly that archiving
 * is a web-portal action. The endpoint question sits with the `hc-patient` owners.
 *
 * <h3>Detail is never cached</h3>
 * Unlike a patient record. A case body is the most sensitive thing this app reads, several people
 * edit it at once, and a stale diagnosis rendered as current is a worse failure than a screen that
 * will not open without signal.
 */
@Component({
  selector: 'hpd-cases',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    FormsModule,
    TranslateModule,
    AsyncBannerComponent,
    EmptyRowComponent,
    PendingChipComponent,
    StatTileComponent,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    IonRefresher,
    IonRefresherContent,
    IonSegment,
    IonSegmentButton,
    IonList,
    IonItem,
    IonLabel,
    IonNote,
    IonBadge,
    IonModal,
    IonSpinner,
    IonTextarea,
    IonInfiniteScroll,
    IonInfiniteScrollContent,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/today"></ion-back-button>
        </ion-buttons>
        <ion-title>{{ 'cases.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="pullToRefresh($event)">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>

      <div class="flex flex-col gap-4 px-4 py-4">
        <hpd-async-banner [status]="store.status()" [fetchedAt]="store.fetchedAt()" savedDataKey="cases.savedData"></hpd-async-banner>

        <div class="flex gap-2">
          <hpd-stat-tile labelKey="cases.countOpen" [value]="store.openCount()"></hpd-stat-tile>
          <hpd-stat-tile labelKey="cases.countUrgent" [value]="store.urgentCount()"></hpd-stat-tile>
          <hpd-stat-tile labelKey="cases.countClosed" [value]="store.closedCount()"></hpd-stat-tile>
        </div>

        <ion-segment [value]="filter()" (ionChange)="applyFilter($any($event).detail.value)" data-test="case-filter">
          <ion-segment-button value="all">{{ 'cases.filterAll' | translate }}</ion-segment-button>
          <ion-segment-button value="open">{{ 'cases.filterOpen' | translate }}</ion-segment-button>
          <ion-segment-button value="urgent">{{ 'cases.filterUrgent' | translate }}</ion-segment-button>
          <ion-segment-button value="closed">{{ 'cases.filterClosed' | translate }}</ion-segment-button>
        </ion-segment>

        <ion-list [inset]="true">
          @for (row of store.rows(); track row.id) {
            <ion-item button (click)="open(row)" [attr.data-test]="'case-' + row.id">
              <ion-label class="ion-text-wrap">
                <h3>{{ row.brief || ('cases.noBrief' | translate) }}</h3>
                <p>{{ 'cases.opened' | translate }} {{ row.openedAt | date: 'mediumDate' : undefined : locale() }}</p>
              </ion-label>
              @if (row.status) {
                <ion-badge slot="end" [color]="row.status === 'urgent' ? 'danger' : 'gold'">{{ row.status }}</ion-badge>
              }
            </ion-item>
          } @empty {
            <hpd-empty-row [status]="store.status()" emptyKey="cases.empty" failedKey="cases.loadFailed"></hpd-empty-row>
          }
        </ion-list>

        <ion-infinite-scroll [disabled]="!store.hasMore()" (ionInfinite)="loadMore($any($event))">
          <ion-infinite-scroll-content [loadingText]="'cases.loadingMore' | translate"></ion-infinite-scroll-content>
        </ion-infinite-scroll>
      </div>

      <!-- Full screen, not a sheet: the house rule, measured on device in MOB7/MOB8. -->
      <ion-modal [isOpen]="store.openCase() !== null || store.opening() || store.openFailed()" (didDismiss)="close()">
        <ng-template>
          <ion-header>
            <ion-toolbar>
              <ion-title>{{ 'cases.detail' | translate }}</ion-title>
              <ion-buttons slot="end">
                <button class="hpd-btn hpd-btn-ghost hpd-focusable" (click)="close()">{{ 'cases.close' | translate }}</button>
              </ion-buttons>
            </ion-toolbar>
          </ion-header>
          <ion-content class="ion-padding">
            @if (store.opening()) {
              <div class="flex justify-center py-8"><ion-spinner name="crescent"></ion-spinner></div>
            } @else if (store.openFailed()) {
              <p class="rounded-hpd-sm bg-hpd-danger-tint px-3 py-2 text-hpd-danger" role="alert">
                {{ 'cases.detailFailed' | translate }}
              </p>
            } @else {
              @if (store.openCase(); as clinicalCase) {
                @if (store.pendingEditFor(); as unsent) {
                  <div class="mb-3"><hpd-pending-chip [state]="unsent.state"></hpd-pending-chip></div>
                }

                <ion-list [inset]="true">
                  <ion-item>
                    <ion-label class="ion-text-wrap">
                      <p>{{ 'cases.brief' | translate }}</p>
                      <h3>{{ clinicalCase.brief || '—' }}</h3>
                    </ion-label>
                  </ion-item>
                  <ion-item>
                    <ion-label>
                      <p>{{ 'cases.opened' | translate }}</p>
                      <h3>{{ clinicalCase.openedAt | date: 'medium' : undefined : locale() }}</h3>
                    </ion-label>
                  </ion-item>
                  <ion-item>
                    <ion-label>
                      <p>{{ 'cases.status' | translate }}</p>
                      <h3>{{ clinicalCase.status ?? '—' }}</h3>
                    </ion-label>
                  </ion-item>
                </ion-list>

                @if (canEdit()) {
                  <ion-list [inset]="true">
                    <ion-item>
                      <ion-textarea
                        label="{{ 'cases.symptoms' | translate }}"
                        labelPlacement="stacked"
                        [autoGrow]="true"
                        [rows]="3"
                        [(ngModel)]="symptoms"
                        data-test="case-symptoms"
                      ></ion-textarea>
                    </ion-item>
                    <ion-item>
                      <ion-textarea
                        label="{{ 'cases.diagnosis' | translate }}"
                        labelPlacement="stacked"
                        [autoGrow]="true"
                        [rows]="3"
                        [(ngModel)]="diagnosis"
                        data-test="case-diagnosis"
                      ></ion-textarea>
                    </ion-item>
                    <ion-item lines="none">
                      <button class="hpd-btn hpd-btn-primary hpd-btn-block hpd-focusable" (click)="save()" data-test="case-save">
                        {{ 'cases.save' | translate }}
                      </button>
                    </ion-item>
                    <ion-item lines="none">
                      <!-- Stated up front: with no signal this is kept, not lost, and not sent yet. -->
                      <ion-note>{{ 'cases.saveQueued' | translate }}</ion-note>
                    </ion-item>
                  </ion-list>
                } @else {
                  <p class="px-4 py-2 text-hpd-muted">{{ 'cases.noPermission' | translate }}</p>
                }

                <!-- Said, not hidden. A button that archives only on this phone would be a lie
                     about a clinical record; the endpoint sits with the hc-patient owners. -->
                <p class="px-4 py-2 text-hpd-muted">{{ 'cases.noArchive' | translate }}</p>
              }
            }
          </ion-content>
        </ng-template>
      </ion-modal>
    </ion-content>
  `,
})
export class CasesPage implements OnInit {
  readonly store = inject(CasesStore);
  private readonly language = inject(LanguageService);
  private readonly accounts = inject(AccountService);

  /** DatePipe formats through LOCALE_ID, which ngx-translate does not touch — pass it explicitly. */
  readonly locale = this.language.current;

  readonly filter = signal('all');

  symptoms = '';
  diagnosis = '';

  /**
   * Whether this clinician may edit a case at all.
   *
   * <p>Mirrors the server rather than replacing it: the PATCH goes through professionalservice,
   * which requires CLINICAL_MUTATION, so a carer's edit is refused whatever this says. What it buys
   * is a screen that does not offer an edit the queue would hold for hours before it is rejected.
   */
  readonly canEdit = computed(() => hasClinicalPermission(this.accounts.account()?.authorities, 'manageCase'));

  async ngOnInit(): Promise<void> {
    await this.store.refresh();
  }

  async applyFilter(value: string): Promise<void> {
    this.filter.set(value);
    await this.store.filterByStatus(value === 'all' ? null : value);
  }

  async open(row: CaseSummaryDto): Promise<void> {
    await this.store.openCaseById(row);
    const opened = this.store.openCase();
    this.symptoms = opened?.symptoms ?? '';
    this.diagnosis = opened?.diagnosis ?? '';
  }

  close(): void {
    this.store.close();
  }

  /** Queues the edit. No spinner and no network check — the queue takes it either way. */
  async save(): Promise<void> {
    await this.store.edit({ symptoms: this.symptoms, diagnosis: this.diagnosis });
  }

  async pullToRefresh(event: Event): Promise<void> {
    await this.store.refresh();
    await (event as CustomEvent).detail.complete();
  }

  async loadMore(event: Event): Promise<void> {
    await this.store.loadMore();
    await (event as CustomEvent).detail.complete();
  }
}
