import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToggle,
  IonToolbar,
  NavController,
} from '@ionic/angular/standalone';

import { ClinicianProfileDto, ProfileApiService } from '../../core/api/profile-api.service';
import { NotificationsApiService } from '../../core/api/notifications-api.service';
import { DutyRosterApiService } from '../../core/api/duty-roster-api.service';
import { AccountService } from '../../core/auth/account.service';
import { AuthService } from '../../core/auth/auth.service';
import { LANGUAGE_NAMES, SUPPORTED_LANGUAGES, SupportedLanguage } from '../../core/i18n/catalogues';
import { LanguageService } from '../../core/i18n/language.service';
import { ShareService } from '../../core/native/share.service';
import { formatRosterSummary } from './roster-summary';

/**
 * The clinician's own settings: who they are, what language the app speaks, and how to leave.
 *
 * <p>Sign-out lives here rather than on the diagnostics screen where it was parked during MOB1.
 * Diagnostics is a developer probe reached by typing a URL; leaving the only way out of the app
 * behind it meant a clinician could not sign out at all.
 *
 * <p>Every string is translated. This is the first screen built that way, so it is also the pattern
 * for retrofitting Today, Messages and Documents — see the MOB11 note in the plan.
 */
@Component({
  selector: 'hpd-me',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TranslateModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonInput,
    IonNote,
    IonButton,
    IonSelect,
    IonSelectOption,
    IonToggle,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ 'me.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-list>
        <ion-list-header>{{ 'me.profile' | translate }}</ion-list-header>

        @if (loadFailed()) {
          <ion-item lines="none">
            <ion-note color="danger">{{ 'me.loadFailed' | translate }}</ion-note>
          </ion-item>
        }

        <ion-item>
          <ion-input
            label="{{ 'me.firstName' | translate }}"
            labelPlacement="stacked"
            [(ngModel)]="firstName"
            data-test="first-name"
          ></ion-input>
        </ion-item>
        <ion-item>
          <ion-input
            label="{{ 'me.lastName' | translate }}"
            labelPlacement="stacked"
            [(ngModel)]="lastName"
            data-test="last-name"
          ></ion-input>
        </ion-item>
        <ion-item>
          <ion-input
            label="{{ 'me.email' | translate }}"
            labelPlacement="stacked"
            type="email"
            [(ngModel)]="email"
            data-test="email"
          ></ion-input>
        </ion-item>
        <ion-item>
          <ion-input
            label="{{ 'me.phone' | translate }}"
            labelPlacement="stacked"
            type="tel"
            [(ngModel)]="mobilePhone"
            data-test="phone"
          ></ion-input>
        </ion-item>

        <ion-item lines="none">
          <ion-button (click)="save()" [disabled]="saving()" data-test="save">{{ 'common.save' | translate }}</ion-button>
          @if (savedMessage(); as message) {
            <ion-note slot="end" [color]="saveFailed() ? 'danger' : 'success'">{{ message | translate }}</ion-note>
          }
        </ion-item>
      </ion-list>

      <ion-list>
        <ion-list-header>{{ 'me.notifications' | translate }}</ion-list-header>

        <ion-item>
          <ion-toggle [checked]="pushMessages()" (ionChange)="setMessages($any($event).detail.checked)" data-test="push-messages">{{
            'me.pushMessages' | translate
          }}</ion-toggle>
        </ion-item>
        <ion-item>
          <ion-toggle [checked]="pushCompliance()" (ionChange)="setCompliance($any($event).detail.checked)" data-test="push-compliance">{{
            'me.pushCompliance' | translate
          }}</ion-toggle>
        </ion-item>
        <ion-item>
          <ion-toggle [checked]="pushSenderName()" (ionChange)="setSenderName($any($event).detail.checked)" data-test="push-sender-name">{{
            'me.pushSenderName' | translate
          }}</ion-toggle>
        </ion-item>
        <ion-item lines="none">
          <ion-note>{{ 'me.pushSenderNameDetail' | translate }}</ion-note>
        </ion-item>
        @if (prefsFailed()) {
          <ion-item lines="none">
            <ion-note color="danger">{{ 'me.prefsSaveFailed' | translate }}</ion-note>
          </ion-item>
        }
      </ion-list>

      <ion-list>
        <ion-list-header>{{ 'me.language' | translate }}</ion-list-header>
        <ion-item>
          <ion-select [value]="language.current()" (ionChange)="changeLanguage($any($event).detail.value)" data-test="language">
            @for (code of languages; track code) {
              <ion-select-option [value]="code">{{ names[code] }}</ion-select-option>
            }
          </ion-select>
        </ion-item>
      </ion-list>

      <ion-list>
        <ion-item lines="none">
          <ion-button expand="block" fill="outline" (click)="shareRoster()" data-test="share">
            {{ 'me.shareRoster' | translate }}
          </ion-button>
        </ion-item>
        @if (shareMessage(); as message) {
          <ion-item lines="none">
            <ion-note>{{ message | translate }}</ion-note>
          </ion-item>
        }
      </ion-list>

      <ion-list>
        <ion-item lines="none">
          <ion-button expand="block" color="danger" fill="outline" (click)="signOut()" data-test="sign-out">
            {{ 'me.signOut' | translate }}
          </ion-button>
        </ion-item>
        <ion-item lines="none">
          <ion-note>{{ 'me.signOutDetail' | translate }}</ion-note>
        </ion-item>
      </ion-list>
    </ion-content>
  `,
})
export class MePage implements OnInit {
  private readonly profiles = inject(ProfileApiService);
  private readonly notifications = inject(NotificationsApiService);
  private readonly rosters = inject(DutyRosterApiService);
  private readonly share = inject(ShareService);
  private readonly auth = inject(AuthService);
  private readonly accounts = inject(AccountService);
  private readonly nav = inject(NavController);
  private readonly translate = inject(TranslateService);
  readonly language = inject(LanguageService);

  readonly languages = SUPPORTED_LANGUAGES;
  readonly names = LANGUAGE_NAMES;

  firstName = '';
  lastName = '';
  email = '';
  mobilePhone = '';

  readonly saving = signal(false);
  readonly saveFailed = signal(false);
  readonly loadFailed = signal(false);
  readonly savedMessage = signal<string | null>(null);
  readonly shareMessage = signal<string | null>(null);

  /**
   * Notification preferences (MOB10). They start at the server's defaults — messages and compliance
   * on, sender name off — so the switches are never blank while the read is in flight, and a device
   * that cannot reach the server shows what the server would actually do rather than all-off.
   */
  readonly pushMessages = signal(true);
  readonly pushCompliance = signal(true);
  readonly pushSenderName = signal(false);
  readonly prefsFailed = signal(false);

  private profile: ClinicianProfileDto = {};

  ngOnInit(): void {
    this.loadPreferences();
    this.profiles.mine().subscribe({
      next: profile => {
        this.profile = profile ?? {};
        this.firstName = profile?.firstName ?? '';
        this.lastName = profile?.lastName ?? '';
        this.email = profile?.email ?? '';
        this.mobilePhone = profile?.mobilePhone ?? '';
      },
      // A clinician who has not completed onboarding has no profile yet; that is a normal state and
      // the form should simply start empty rather than shouting about it.
      error: () => this.loadFailed.set(true),
    });
  }

  save(): void {
    this.saving.set(true);
    this.savedMessage.set(null);
    // Spread the loaded document so fields this page does not edit — identity card, address,
    // notification preferences — are preserved rather than blanked by a partial write.
    this.profiles
      .save({ ...this.profile, firstName: this.firstName, lastName: this.lastName, email: this.email, mobilePhone: this.mobilePhone })
      .subscribe({
        next: saved => {
          this.profile = saved ?? this.profile;
          this.saving.set(false);
          this.saveFailed.set(false);
          this.savedMessage.set('me.saved');
        },
        error: () => {
          this.saving.set(false);
          this.saveFailed.set(true);
          this.savedMessage.set('me.saveFailed');
        },
      });
  }

  async changeLanguage(code: SupportedLanguage): Promise<void> {
    await this.language.use(code);
    // No device re-registration here: PushRegistrationService watches the language signal, so the
    // server learns the new language whether it was changed from this page or anywhere else.
  }

  setMessages(enabled: boolean): void {
    this.pushMessages.set(enabled);
    this.savePreferences();
  }

  setCompliance(enabled: boolean): void {
    this.pushCompliance.set(enabled);
    this.savePreferences();
  }

  setSenderName(enabled: boolean): void {
    this.pushSenderName.set(enabled);
    this.savePreferences();
  }

  private loadPreferences(): void {
    this.notifications.preferences().subscribe({
      next: preferences => {
        this.pushMessages.set(preferences.messages);
        this.pushCompliance.set(preferences.compliance);
        this.pushSenderName.set(preferences.showSenderName);
      },
      // Offline, or a profile that does not exist yet. The defaults above are the honest answer to
      // "what happens if a notification arrives now", so there is nothing to report.
      error: () => undefined,
    });
  }

  /**
   * Writes all three on every change.
   *
   * <p>There is no Save button for this list, because a settings toggle that needs confirming reads
   * as broken. The three go together because the endpoint replaces all three — a partial body would
   * be indistinguishable from "off".
   */
  private savePreferences(): void {
    this.prefsFailed.set(false);
    this.notifications
      .savePreferences({
        messages: this.pushMessages(),
        compliance: this.pushCompliance(),
        showSenderName: this.pushSenderName(),
      })
      .subscribe({
        next: saved => {
          // Take the server's answer, not the optimistic local one: it is what will actually be
          // consulted when an event arrives.
          this.pushMessages.set(saved.messages);
          this.pushCompliance.set(saved.compliance);
          this.pushSenderName.set(saved.showSenderName);
        },
        error: () => this.prefsFailed.set(true),
      });
  }

  shareRoster(): void {
    this.shareMessage.set(null);
    this.rosters.myAssignments().subscribe({
      next: async assignments => {
        const title = this.translate.instant('me.rosterTitle');
        const text = formatRosterSummary(assignments, { title });
        if (!text) {
          this.shareMessage.set('me.noRoster');
          return;
        }
        // canShare is checked rather than assumed: the sheet is unavailable in a browser, which is
        // where the app runs during development and in the Playwright e2e the plan calls for.
        if (!(await this.share.canShare())) {
          this.shareMessage.set('me.shareUnavailable');
          return;
        }
        await this.share.shareText({ title, text });
      },
      error: () => this.shareMessage.set('me.noRoster'),
    });
  }

  signOut(): void {
    // logout() is an ordered sequence — revoke the refresh family server-side while the token is
    // still valid, then wipe locally. AuthService owns that order; this only handles the UI after.
    this.auth.logout('user').subscribe(() => {
      this.accounts.clear();
      void this.nav.navigateRoot(['/login'], { replaceUrl: true });
    });
  }
}
