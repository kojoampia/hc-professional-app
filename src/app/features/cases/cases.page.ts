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
import { ArchivedBannerComponent } from './archived-banner.component';
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
 * <h3>There is an archive button, and the reason it is doctor-only is not the obvious one</h3>
 * This section said the opposite until `../docs/backlog.md` item 106 — *"there is no archive button,
 * and that is a decision"*, arguing archiving was a web-portal action while the button sat thirty
 * lines below it. It had been true: `web/`'s was client-side only, its own comment saying *no archive
 * endpoint specced*, so a case reappeared on the next load. That stopped being true on 2026-08-24 when
 * the real endpoint shipped and this screen got the action; the paragraph outlived its subject by two
 * and a half weeks with nothing failing, because prose does not compile.
 *
 * <p>The part worth keeping is the part a reader will not guess: the action is **doctor-only, and
 * `ROLE_ADMIN` is excluded on purpose**, which inverts the usual rule in this estate where admin is a
 * superset. patientservice excludes it from `/archive` because retiring a case is a clinical judgement
 * — "this episode of care is finished" — rather than a records action, and `ScopeOfPractice` grants the
 * `DIAGNOSIS` write to doctor alone. See `web-mobile-port.md` § "Decision 6, reversed".
 *
 * <h3>An archived case says so, and is treated no differently otherwise</h3>
 * This detail read is the only endpoint in the stack that serves a retired case — the queue and the
 * patient's case list exclude them — so it is the only screen that can say a case is retired, and it
 * said nothing until `../docs/backlog.md` item 104. A banner, not a badge on the queue row and not a
 * dimmed page: the row is stale by design and marking it is a different change, while a page that
 * cannot be acted on re-creates the 404 item 82 had just removed.
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
    ArchivedBannerComponent,
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
              @if (store.pendingArchiveIds().has(row.id)) {
                <!-- The row stays until the server drops it. Marked, so it does not read as a
                     failed archive that simply did nothing. -->
                <ion-badge slot="end" color="medium">{{ 'cases.archivePending' | translate }}</ion-badge>
              } @else if (row.status) {
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
                <!-- First thing on the page, because a retired diagnosis read as current is the
                     defect this exists for. It says and does not gate: the edit and archive
                     controls below are untouched. -->
                <hpd-archived-banner [archivedAt]="clinicalCase.archivedAt"></hpd-archived-banner>

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

                @if (canArchive()) {
                  <ion-list [inset]="true">
                    @if (store.pendingArchiveFor(); as unsent) {
                      <ion-item lines="none">
                        <hpd-pending-chip [state]="unsent.state"></hpd-pending-chip>
                      </ion-item>
                    }
                    <ion-item>
                      <!-- Asked for, never defaulted. The server answers 400 to a blank reason and
                           says why: an archive with no reason is the delete it exists to replace. -->
                      <ion-textarea
                        label="{{ 'cases.archiveReason' | translate }}"
                        labelPlacement="stacked"
                        [autoGrow]="true"
                        [rows]="2"
                        [(ngModel)]="archiveReason"
                        data-test="case-archive-reason"
                      ></ion-textarea>
                    </ion-item>
                    <ion-item lines="none">
                      <button
                        class="hpd-btn hpd-btn-danger hpd-btn-block hpd-focusable"
                        [disabled]="!archiveReason.trim()"
                        (click)="archive()"
                        data-test="case-archive"
                      >
                        {{ 'cases.archive' | translate }}
                      </button>
                    </ion-item>
                    <ion-item lines="none">
                      <ion-note>{{ 'cases.archiveHint' | translate }}</ion-note>
                    </ion-item>
                  </ion-list>
                } @else {
                  <!-- Said, not hidden. patientservice gates archiving on doctor alone, and an
                       admin is excluded there on purpose — see hc-patient-service#13. -->
                  <p class="px-4 py-2 text-hpd-muted">{{ 'cases.archiveDoctorOnly' | translate }}</p>
                }
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
  archiveReason = '';

  /**
   * Whether this clinician may edit a case at all.
   *
   * <p>Mirrors the server rather than replacing it: the PATCH goes through professionalservice,
   * which requires CLINICAL_MUTATION, so a carer's edit is refused whatever this says. What it buys
   * is a screen that does not offer an edit the queue would hold for hours before it is rejected.
   */
  readonly canEdit = computed(() => hasClinicalPermission(this.accounts.account()?.authorities, 'manageCase'));

  /**
   * Whether this clinician may retire a case — a narrower question than {@link canEdit}.
   *
   * <p>Doctor only, and an admin is excluded. A nurse who may rewrite the diagnosis on this very
   * screen still may not archive it, which looks inconsistent until you read patientservice's
   * `ScopeOfPractice`: `DIAGNOSIS` writes are the doctor's, and a `ClinicalCase` maps to
   * `DIAGNOSIS`. Mirroring it here is what keeps the queue from holding an archive for hours
   * before the server refuses it.
   */
  readonly canArchive = computed(() => hasClinicalPermission(this.accounts.account()?.authorities, 'archiveCase'));

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
    // Never carried between cases. A reason typed for one case is not a reason for the next, and
    // one left in the box is one archive away from being filed against the wrong record.
    this.archiveReason = '';
  }

  close(): void {
    this.store.close();
  }

  /** Queues the edit. No spinner and no network check — the queue takes it either way. */
  async save(): Promise<void> {
    await this.store.edit({ symptoms: this.symptoms, diagnosis: this.diagnosis });
  }

  /**
   * Queues the archive.
   *
   * <p>The blank guard is here as well as on the button's `disabled` because a whitespace-only
   * reason passes an `ngModel` truthiness check and then fails on the server, 24 hours of retries
   * later, as `reasonrequired`.
   */
  async archive(): Promise<void> {
    const reason = this.archiveReason.trim();
    if (!reason) {
      return;
    }
    await this.store.archive(reason);
    this.archiveReason = '';
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
