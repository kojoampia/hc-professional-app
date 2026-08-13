import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  IonBadge,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonModal,
  IonNote,
  IonProgressBar,
  IonRefresher,
  IonRefresherContent,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';

import { DocumentType, PersonalDocumentDto } from '../../core/api/onboarding-api.service';
import { LanguageService } from '../../core/i18n/language.service';
import { RelativeTime } from '../../core/i18n/relative-time.service';
import { NetworkService } from '../../core/native/network.service';

import { DocumentsStore } from './documents.store';

/** The types a working clinician actually re-uploads. The full applicant set lives on the web portal. */
const RENEWABLE_TYPES: DocumentType[] = ['LICENSE', 'CERTIFICATE', 'NHIS', 'OTHER'];

@Component({
  selector: 'hpd-documents',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslateModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonRefresher,
    IonRefresherContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonBadge,
    IonModal,
    IonSelect,
    IonSelectOption,
    IonProgressBar,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ 'documents.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="pullToRefresh($event)">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>

      <div class="px-4 py-4 flex flex-col gap-4">
        @if (!network.connected() || store.documents.status() === 'stale') {
          <p class="rounded-hpd-sm bg-hpd-warning-tint px-3 py-2 text-hpd-warning" role="status">
            {{ (network.connected() ? 'documents.savedData' : 'documents.savedDataOffline') | translate }} ·
            {{ 'today.updated' | translate }} {{ age() }}
          </p>
        }

        <button class="hpd-btn hpd-btn-primary hpd-btn-block hpd-focusable" [disabled]="busy()" (click)="openForm()">
          {{ 'documents.addOrRenew' | translate }}
        </button>

        <ion-list [inset]="true">
          <ion-list-header
            ><ion-label>{{ 'documents.yours' | translate }}</ion-label></ion-list-header
          >
          @for (doc of store.byNewest(); track doc.id) {
            <ion-item>
              <ion-label>
                {{ label(doc) }}
                @if (doc.expiryDate) {
                  <p class="text-hpd-muted">{{ 'documents.expires' | translate }} {{ doc.expiryDate }}</p>
                }
              </ion-label>
              <ion-badge slot="end" [color]="statusColour(doc.verificationStatus)">
                {{ doc.verificationStatus.toLowerCase() }}
              </ion-badge>
            </ion-item>
          } @empty {
            <ion-item lines="none">
              <ion-label class="text-hpd-muted">
                {{ (store.documents.status() === 'error' ? 'documents.loadFailed' : 'documents.empty') | translate }}
              </ion-label>
            </ion-item>
          }
        </ion-list>
      </div>

      <!-- Upload form -->

      <!-- Upload progress / result -->
    </ion-content>

    <!--
      Full-screen, not a sheet. A sheet's wrapper stays full height and is translated down by
      (1 - breakpoint), so at 0.7 its bottom 30% — and at 0.4 its bottom 60% — sits outside the
      viewport. Measured on a device: the 0.4 sheet ran 520px to 1316px against an 838px screen,
      overflowing by 478px, which put the Done and Close buttons where no scroll could reach them.
      The same shape broke the message composer. If a sheet is ever wanted back here, the content
      has to be constrained to the visible fraction rather than laid out over the full height.
    -->
    <ion-modal [isOpen]="formOpen()" (ionModalDidDismiss)="formOpen.set(false)">
      <ng-template>
        <ion-header>
          <ion-toolbar
            ><ion-title>{{ 'documents.add' | translate }}</ion-title></ion-toolbar
          >
        </ion-header>
        <ion-content>
          <div class="px-4 py-4 flex flex-col gap-4">
            <div>
              <p class="hpd-label">{{ 'documents.type' | translate }}</p>
              <ion-select [(ngModel)]="type" interface="action-sheet" fill="outline" placeholder="{{ 'documents.choose' | translate }}">
                @for (option of types; track option) {
                  <ion-select-option [value]="option">{{ option.toLowerCase() }}</ion-select-option>
                }
              </ion-select>
            </div>

            @if (type === 'OTHER') {
              <div>
                <label class="hpd-label" for="doc-label">{{ 'documents.label' | translate }}</label>
                <input
                  id="doc-label"
                  class="hpd-input"
                  [(ngModel)]="otherLabel"
                  placeholder="{{ 'documents.labelPlaceholder' | translate }}"
                />
              </div>
            }

            @if (type === 'LICENSE') {
              <div>
                <label class="hpd-label" for="doc-expiry">{{ 'documents.expiryDate' | translate }}</label>
                <!-- The server rejects a LICENSE with no expiry, so ask before uploading
                     rather than after a 400 the clinician cannot act on. -->
                <input id="doc-expiry" type="date" class="hpd-input" [(ngModel)]="expiryDate" />
              </div>
            }

            @if (validationError(); as message) {
              <p class="rounded-hpd-sm bg-hpd-danger-tint px-3 py-2 text-hpd-danger" role="alert">{{ message }}</p>
            }

            <button class="hpd-btn hpd-btn-primary hpd-btn-block hpd-focusable" [disabled]="busy()" (click)="takePhoto()">
              {{ 'documents.takePhoto' | translate }}
            </button>

            <button class="hpd-btn hpd-btn-ghost hpd-btn-block hpd-focusable" [disabled]="busy()" (click)="picker.click()">
              {{ 'documents.choosePdfOrImage' | translate }}
            </button>
            <input #picker type="file" class="hidden" accept="application/pdf,image/png,image/jpeg" (change)="pick($event)" />

            <p class="text-hpd-muted">{{ 'documents.privacyNote' | translate }}</p>
          </div>
        </ion-content>
      </ng-template>
    </ion-modal>

    <ion-modal [isOpen]="store.upload().stage !== 'idle'" [backdropDismiss]="false">
      <ng-template>
        <ion-content>
          <div class="flex min-h-full flex-col items-center justify-center gap-4 px-6 text-center">
            @switch (store.upload().stage) {
              @case ('preparing') {
                <p class="text-hpd-muted">{{ 'documents.preparing' | translate }}</p>
                <ion-progress-bar type="indeterminate"></ion-progress-bar>
              }
              @case ('uploading') {
                <p class="text-hpd-muted">{{ 'documents.uploading' | translate }}</p>
                @if (store.upload().fraction; as fraction) {
                  <ion-progress-bar [value]="fraction"></ion-progress-bar>
                  <p class="text-hpd-subtle">{{ (fraction * 100).toFixed(0) }}%</p>
                } @else {
                  <ion-progress-bar type="indeterminate"></ion-progress-bar>
                }
              }
              @case ('done') {
                <p class="font-semibold text-hpd-success">{{ 'documents.uploaded' | translate }}</p>
                <p class="text-hpd-muted">{{ 'documents.pendingReview' | translate }}</p>
                <button class="hpd-btn hpd-btn-primary hpd-focusable" (click)="finish()">{{ 'documents.done' | translate }}</button>
              }
              @default {
                <p class="text-hpd-danger" role="alert">{{ store.upload().message }}</p>
                <button class="hpd-btn hpd-btn-primary hpd-focusable" (click)="store.dismissUpload()">
                  {{ 'messages.close' | translate }}
                </button>
              }
            }
          </div>
        </ion-content>
      </ng-template>
    </ion-modal>
  `,
  styles: [
    `
      .hidden {
        display: none;
      }
    `,
  ],
})
export class DocumentsPage implements OnInit {
  readonly store = inject(DocumentsStore);
  readonly network = inject(NetworkService);
  private readonly relativeTime = inject(RelativeTime);
  /** DatePipe formats through LOCALE_ID, which ngx-translate does not touch — pass it explicitly. */
  readonly locale = inject(LanguageService).current;
  private readonly translate = inject(TranslateService);

  readonly types = RENEWABLE_TYPES;
  type: DocumentType = 'LICENSE';
  otherLabel = '';
  expiryDate = '';

  readonly formOpen = signal(false);
  private readonly nowTick = signal(Date.now());
  readonly age = computed(() => this.relativeTime.describe(this.store.documents.fetchedAt(), this.nowTick()));

  readonly busy = computed(() => ['preparing', 'uploading'].includes(this.store.upload().stage));

  /** Mirrors the server's own preconditions so a clinician is told before uploading. */
  readonly validationError = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.store.refresh();
    this.nowTick.set(Date.now());
  }

  label(doc: PersonalDocumentDto): string {
    return doc.otherLabel || doc.type.toLowerCase();
  }

  statusColour(status: string): string {
    return status === 'VERIFIED' ? 'success' : status === 'REJECTED' ? 'danger' : 'warning';
  }

  openForm(): void {
    this.validationError.set(null);
    this.formOpen.set(true);
  }

  async takePhoto(): Promise<void> {
    if (!this.validate()) {
      return;
    }
    this.formOpen.set(false);
    await this.store.captureAndUpload(this.type, this.options());
  }

  async pick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.validate()) {
      return;
    }
    this.formOpen.set(false);
    await this.store.uploadPicked(file, this.type, this.options());
  }

  finish(): void {
    this.store.dismissUpload();
    this.otherLabel = '';
    this.expiryDate = '';
  }

  async pullToRefresh(event: Event): Promise<void> {
    await this.store.refresh();
    this.nowTick.set(Date.now());
    (event as CustomEvent).detail?.complete?.();
  }

  private validate(): boolean {
    if (this.type === 'LICENSE' && !this.expiryDate) {
      this.validationError.set('A licence needs its expiry date.');
      return false;
    }
    if (this.type === 'OTHER' && !this.otherLabel.trim()) {
      this.validationError.set(this.translate.instant('documents.labelRequired'));
      return false;
    }
    this.validationError.set(null);
    return true;
  }

  private options(): { otherLabel?: string; expiryDate?: string } {
    return {
      otherLabel: this.type === 'OTHER' ? this.otherLabel.trim() : undefined,
      expiryDate: this.type === 'LICENSE' ? this.expiryDate : undefined,
    };
  }
}
