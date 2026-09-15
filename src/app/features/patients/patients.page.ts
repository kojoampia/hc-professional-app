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
  IonInput,
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
  IonTextarea,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';

import { LanguageService } from '../../core/i18n/language.service';
import { NetworkService } from '../../core/native/network.service';
import { AsyncBannerComponent } from '../../shared/async-banner.component';
import { EmptyRowComponent } from '../../shared/empty-row.component';
import { AccountService } from '../../core/auth/account.service';
import { hasClinicalPermission } from '../../core/auth/clinical-permissions';
import { PendingChipComponent } from '../../shared/pending-chip.component';
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
 * <h3>A refused part is said, and the two are said differently</h3>
 * `GET /api/patients` degrades rather than failing for a discipline with no scope over one of the
 * reads it composes, and names what it dropped in `X-Restricted-Parts` (`../docs/backlog.md` items
 * 107, 111 and 114). The two tokens get two treatments because they are two different losses.
 *
 * <p>`lastActivity` blanks a <b>field</b>, so it is answered where the false sentence was printed:
 * the row's recency line, which said "No activity recorded" — a quiet caseload — when it meant "not
 * yours to see". A banner alone would have left that line on every row.
 *
 * <p>`caseAssignments` removes <b>people</b>, and no row can describe a patient who is not in the
 * list, so it is answered once above the list. That is the same reasoning that killed a per-row
 * field in the wire contract.
 *
 * <p>An absent header renders nothing at all — five of the eight disciplines never see one — and an
 * unrecognised token is dropped rather than shown.
 *
 * <h3>The record answers the same token with its own sentence</h3>
 * `GET /api/patients/{id}` emits the header too since item 112, and it names `lastActivity` — the
 * directory's own token, costing something entirely different. Here the panel is withheld
 * <b>whole</b>, so the empty-state note `patients.noActivity` ("No activity recorded.") is a quiet
 * patient written where "not yours to see" belongs, and it is a clinical reading rather than a
 * cosmetic one.
 *
 * <p>So the refusal <b>replaces the list and its empty state</b> rather than sitting beside them,
 * and it uses `patients.activityRestricted`, not the row's `patients.recencyRestricted`. Item 129
 * records why: telling a pharmacist that recent-activity sorting is unavailable, when the whole
 * history is missing, is a new false sentence committed while fixing one.
 *
 * <p>`caseAssignments` gets no record treatment and must not grow one — it never arrives here,
 * because a record whose case read was refused is not served at all.
 *
 * <h3>An unsent note is marked on the record, never merged into it</h3>
 * A note filed with no signal is held by the write queue, sometimes for hours. It appears at the top
 * of its list straight away, with `hpd-pending-chip` and a warning left border, and it is the queued
 * op's own state that the chip reads — so a rejection or a conflict is visible where the note is
 * rather than only under Me. It is never drawn as a filed entry: the whole value of the record is
 * that it says what happened.
 *
 * <p>The chip was imported here and rendered nowhere, and `PatientsStore.pendingForOpenRecord` was
 * computed and read by nothing, from Phase 6 until item 122 — the same shape of defect as the
 * unreachable filing button, one layer up. `ng build` warned about the unused import on every build.
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
    PendingChipComponent,
    FormsModule,
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
    IonInput,
    IonTextarea,
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

        @if (store.rowsRestricted()) {
          <p class="rounded-hpd-sm bg-hpd-warning-tint px-3 py-2 text-hpd-warning" role="status" data-test="rows-restricted">
            {{ 'patients.rowsRestricted' | translate }}
          </p>
        }

        <ion-list [inset]="true">
          @for (patient of store.rows(); track patient.id) {
            <ion-item button (click)="open(patient.id)" [attr.data-test]="'patient-' + patient.id">
              <ion-label>
                <h3>{{ patient.patientName }}</h3>
                <p [class.text-hpd-muted]="store.recencyRestricted()">
                  @if (store.recencyRestricted()) {
                    {{ 'patients.recencyRestricted' | translate }}
                  } @else if (patient.lastActivityAt) {
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
                  <!-- Unsent notes first, marked, and OUTSIDE the restriction branch below: they
                       are this clinician's own writing held by the queue, not anything the server
                       composed, so a withheld history says nothing about them. Above the filed
                       ones because the newest thing a clinician did is what they are looking for.
                       (../docs/backlog.md item 122.) -->
                  @for (unsent of pendingActivities(); track unsent.write.id) {
                    <ion-item class="border-l-4 border-hpd-warning-accent" data-test="pending-activity">
                      <ion-label class="ion-text-wrap">
                        <h3>{{ unsent.label }}</h3>
                        <p>{{ unsent.write.createdAt | date: 'medium' : undefined : locale() }}</p>
                        <hpd-pending-chip [state]="unsent.state"></hpd-pending-chip>
                      </ion-label>
                    </ion-item>
                  }
                  @if (store.recordActivityRestricted()) {
                    <ion-item lines="none">
                      <p
                        class="rounded-hpd-sm bg-hpd-warning-tint px-3 py-2 text-hpd-warning"
                        role="status"
                        data-test="record-activity-restricted"
                      >
                        {{ 'patients.activityRestricted' | translate }}
                      </p>
                    </ion-item>
                  } @else {
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
                      <!-- Not said while an unsent note is on screen above it: "No activity
                           recorded" beside a note the clinician has just written reads as though
                           the app lost it. -->
                      @if (pendingActivities().length === 0) {
                        <ion-item lines="none"
                          ><ion-note>{{ 'patients.noActivity' | translate }}</ion-note></ion-item
                        >
                      }
                    }
                  }
                </ion-list>

                <ion-list [inset]="true">
                  <ion-list-header>{{ 'patients.reports' | translate }}</ion-list-header>
                  <!-- Same treatment for the other kind the queue carries. Nothing on this screen
                       files a report yet, but the store queues them and the record is where an
                       unsent one belongs — the alternative is a second place for it to be invisible. -->
                  @for (unsent of pendingReports(); track unsent.write.id) {
                    <ion-item class="border-l-4 border-hpd-warning-accent" data-test="pending-report">
                      <ion-label class="ion-text-wrap">
                        <h3>{{ unsent.label }}</h3>
                        <p>{{ unsent.write.createdAt | date: 'mediumDate' : undefined : locale() }}</p>
                        <hpd-pending-chip [state]="unsent.state"></hpd-pending-chip>
                      </ion-label>
                    </ion-item>
                  }
                  @for (item of record.reports; track item.id) {
                    <ion-item>
                      <ion-label>
                        <h3>{{ item.label }}</h3>
                        <p>{{ item.occurredAt | date: 'mediumDate' : undefined : locale() }} · {{ item.reportType }}</p>
                      </ion-label>
                    </ion-item>
                  } @empty {
                    @if (pendingReports().length === 0) {
                      <ion-item lines="none"
                        ><ion-note>{{ 'patients.noReports' | translate }}</ion-note></ion-item
                      >
                    }
                  }
                </ion-list>

                <!-- Phase 6's way in. This was missing: the modal, the handler, the queue op and the
                     permission gate all existed and nothing opened them, so filing was unreachable
                     and a stale Phase-5 line sat here naming a translation key that was never
                     added, rendering the text patients.readOnly to the clinician verbatim. (No
                     backticks in this comment: the template IS a backtick string and one inside a
                     comment ends it hundreds of lines early.)

                     Said rather than hidden for a read-only role: someone who expects to file and
                     finds no button assumes the app is broken. -->
                @if (canFile()) {
                  <ion-item lines="none">
                    <button class="hpd-btn hpd-btn-primary hpd-btn-block hpd-focusable" (click)="openFiling()" data-test="open-filing">
                      {{ 'patients.fileActivity' | translate }}
                    </button>
                  </ion-item>
                } @else {
                  <p class="text-hpd-muted px-4 py-2">{{ 'patients.cannotFile' | translate }}</p>
                }
              }
            }
          </ion-content>
        </ng-template>
      </ion-modal>

      <ion-modal [isOpen]="filing()" (didDismiss)="filing.set(false)">
        <ng-template>
          <ion-header>
            <ion-toolbar>
              <ion-title>{{ 'patients.fileActivity' | translate }}</ion-title>
              <ion-buttons slot="end">
                <button class="hpd-btn hpd-btn-ghost hpd-focusable" (click)="filing.set(false)">
                  {{ 'patients.close' | translate }}
                </button>
              </ion-buttons>
            </ion-toolbar>
          </ion-header>
          <ion-content class="ion-padding">
            @if (filingError(); as error) {
              <p class="mb-3 rounded-hpd-sm bg-hpd-danger-tint px-3 py-2 text-hpd-danger" role="alert">{{ error | translate }}</p>
            }
            <ion-list>
              <ion-item>
                <ion-input
                  label="{{ 'patients.activityTitle' | translate }}"
                  labelPlacement="stacked"
                  [(ngModel)]="activityTitle"
                  data-test="activity-title"
                ></ion-input>
              </ion-item>
              <ion-item>
                <ion-textarea
                  label="{{ 'patients.activityDetail' | translate }}"
                  labelPlacement="stacked"
                  [autoGrow]="true"
                  [rows]="3"
                  [(ngModel)]="activityDetail"
                  data-test="activity-detail"
                ></ion-textarea>
              </ion-item>
              <ion-item lines="none">
                <button class="hpd-btn hpd-btn-primary hpd-btn-block hpd-focusable" (click)="file()" data-test="activity-submit">
                  {{ 'patients.file' | translate }}
                </button>
              </ion-item>
              <ion-item lines="none">
                <!-- Stated up front: with no signal this is kept, not lost, and not sent yet. -->
                <ion-note>{{ 'patients.fileQueued' | translate }}</ion-note>
              </ion-item>
            </ion-list>
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
  private readonly accounts = inject(AccountService);

  /** DatePipe formats through LOCALE_ID, which ngx-translate does not touch — pass it explicitly. */
  readonly locale = this.language.current;

  readonly filter = signal('all');

  readonly filing = signal(false);
  readonly filingError = signal<string | null>(null);
  activityTitle = '';
  activityDetail = '';

  /**
   * Whether this clinician may file at all.
   *
   * <p>Mirrors the server rather than replacing it: `/api/patients/**` requires CLINICAL_MUTATION,
   * so a carer's write is refused whatever this says. What it buys is the difference between a
   * button that 403s and a button that is not offered — and with a queue in play, between a note
   * held for hours before rejection and one never accepted.
   */
  readonly canFile = computed(() => hasClinicalPermission(this.accounts.account()?.authorities, 'manageActivity'));

  /**
   * The unsent entries for the record on screen, split by where each one belongs.
   *
   * <p>Split here rather than in the store: the store answers "what has this clinician written that
   * has not landed", which is one question, and the record draws it in two lists. Doing it in the
   * template would mean two filters re-run on every change detection instead of one memoized signal
   * each.
   *
   * <p>`PatientsStore.pendingForOpenRecord` existed, was proved by `patients.store.spec.ts`, and
   * reached no screen at all until this — the chip was even imported by this component and never
   * rendered, which `ng build` reported as a warning nobody read (`../docs/backlog.md` item 122).
   * A clinician who filed a note in a basement saw it vanish into the record as though nothing had
   * happened.
   */
  readonly pendingActivities = computed(() => this.store.pendingForOpenRecord().filter(entry => entry.kind === 'activity'));

  readonly pendingReports = computed(() => this.store.pendingForOpenRecord().filter(entry => entry.kind === 'report'));

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

  openFiling(): void {
    this.activityTitle = '';
    this.activityDetail = '';
    this.filingError.set(null);
    this.filing.set(true);
  }

  /**
   * Queues the entry. No spinner and no network check: the queue takes it either way, and telling
   * the clinician it is saved-and-will-send is the honest description of both cases.
   */
  async file(): Promise<void> {
    if (!this.activityTitle.trim()) {
      this.filingError.set('patients.fileNeedsText');
      return;
    }
    const patientId = this.store.record()?.id;
    if (!patientId) {
      return;
    }
    await this.store.fileActivity(patientId, { title: this.activityTitle.trim(), description: this.activityDetail.trim() });
    this.filing.set(false);
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
