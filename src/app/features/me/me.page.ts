import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  IonAlert,
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

import { ClinicianProfileDto, OnboardingProgressDto, ProfileApiService } from '../../core/api/profile-api.service';
import { AccountApiService, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../core/api/account-api.service';
import { CompletionMeterComponent } from '../../shared/completion-meter.component';
import { NotificationsApiService } from '../../core/api/notifications-api.service';
import { WriteQueue } from '../../core/offline/write-queue.service';
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
    CompletionMeterComponent,
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
    IonAlert,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ 'me.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <!-- Above the form, because it is the reason to fill the form in. -->
      <hpd-completion-meter [progress]="progress()"></hpd-completion-meter>

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

        <ion-item>
          <ion-input
            label="{{ 'me.birthDate' | translate }}"
            labelPlacement="stacked"
            type="date"
            [(ngModel)]="birthDate"
            data-test="birth-date"
          ></ion-input>
        </ion-item>
        <ion-item>
          <!-- Server enum values, deliberately untranslated: the administrator's review queue shows
               them in exactly this form, and translating only the phone's copy would have the two
               describing one person differently.

               Bound from an array rather than written out, so untranslated-literals.spec.ts sees
               an interpolation instead of eight capitalised literals it is right to object to. The
               alternative was teaching that scanner an ALL_CAPS exemption, which would also let a
               genuinely untranslated shout through. (No backticks in here: this template IS a
               backtick string, and one inside a comment ends it several hundred lines early.) -->
          <ion-select label="{{ 'me.sex' | translate }}" labelPlacement="stacked" [(ngModel)]="sex" data-test="sex">
            @for (value of SEXES; track value) {
              <ion-select-option [value]="value">{{ value }}</ion-select-option>
            }
          </ion-select>
        </ion-item>
        <ion-item>
          <ion-select label="{{ 'me.cardType' | translate }}" labelPlacement="stacked" [(ngModel)]="cardType" data-test="card-type">
            @for (value of CARD_TYPES; track value) {
              <ion-select-option [value]="value">{{ value }}</ion-select-option>
            }
          </ion-select>
        </ion-item>
        <ion-item>
          <ion-input
            label="{{ 'me.cardNumber' | translate }}"
            labelPlacement="stacked"
            [(ngModel)]="cardNumber"
            data-test="card-number"
          ></ion-input>
        </ion-item>

        <ion-list-header>{{ 'me.address' | translate }}</ion-list-header>
        <ion-item>
          <ion-input label="{{ 'me.street' | translate }}" labelPlacement="stacked" [(ngModel)]="street" data-test="street"></ion-input>
        </ion-item>
        <ion-item>
          <ion-input label="{{ 'me.city' | translate }}" labelPlacement="stacked" [(ngModel)]="city" data-test="city"></ion-input>
        </ion-item>
        <ion-item>
          <ion-input label="{{ 'me.region' | translate }}" labelPlacement="stacked" [(ngModel)]="region" data-test="region"></ion-input>
        </ion-item>
        <ion-item>
          <ion-input label="{{ 'me.country' | translate }}" labelPlacement="stacked" [(ngModel)]="country" data-test="country"></ion-input>
        </ion-item>

        <ion-list-header>{{ 'me.nextOfKin' | translate }}</ion-list-header>
        <ion-item>
          <ion-input label="{{ 'me.kinName' | translate }}" labelPlacement="stacked" [(ngModel)]="kinName" data-test="kin-name"></ion-input>
        </ion-item>
        <ion-item>
          <ion-input
            label="{{ 'me.kinRelationship' | translate }}"
            labelPlacement="stacked"
            [(ngModel)]="kinRelationship"
            data-test="kin-relationship"
          ></ion-input>
        </ion-item>
        <ion-item>
          <ion-input
            label="{{ 'me.kinPhone' | translate }}"
            labelPlacement="stacked"
            type="tel"
            [(ngModel)]="kinPhone"
            data-test="kin-phone"
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

      @if (queue.needingAttention().length > 0) {
        <ion-list>
          <ion-list-header>{{ 'me.unsent' | translate }}</ion-list-header>
          @for (write of queue.needingAttention(); track write.id) {
            <ion-item>
              <ion-label>
                <h3>{{ write.kind }}</h3>
                <p class="text-hpd-danger">
                  {{
                    (write.state === 'conflict'
                      ? 'me.unsentConflict'
                      : write.state === 'expired'
                        ? 'me.unsentExpired'
                        : 'me.unsentRejected'
                    ) | translate
                  }}
                </p>
              </ion-label>
              <ion-button slot="end" fill="clear" (click)="retryWrite(write.id)" data-test="retry-write">
                {{ 'me.unsentRetry' | translate }}
              </ion-button>
              <ion-button slot="end" fill="clear" color="danger" (click)="discardWrite(write.id)" data-test="discard-write">
                {{ 'me.unsentDiscard' | translate }}
              </ion-button>
            </ion-item>
          }
        </ion-list>
      }

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
      <ion-list>
        <ion-list-header>{{ 'me.password' | translate }}</ion-list-header>
        @if (passwordMessage(); as message) {
          <ion-item lines="none">
            <ion-note [color]="passwordFailed() ? 'danger' : 'success'" data-test="password-message">{{ message | translate }}</ion-note>
          </ion-item>
        }
        <ion-item>
          <ion-input
            label="{{ 'me.currentPassword' | translate }}"
            labelPlacement="stacked"
            type="password"
            [(ngModel)]="currentPassword"
            data-test="current-password"
          ></ion-input>
        </ion-item>
        <ion-item>
          <ion-input
            label="{{ 'me.newPassword' | translate }}"
            labelPlacement="stacked"
            type="password"
            [(ngModel)]="newPassword"
            data-test="new-password"
          ></ion-input>
        </ion-item>
        <ion-item>
          <ion-input
            label="{{ 'me.confirmPassword' | translate }}"
            labelPlacement="stacked"
            type="password"
            [(ngModel)]="confirmPassword"
            data-test="confirm-password"
          ></ion-input>
        </ion-item>
        <ion-item lines="none">
          <ion-button (click)="changePassword()" [disabled]="changingPassword()" data-test="change-password">
            {{ 'me.changePassword' | translate }}
          </ion-button>
        </ion-item>
        <ion-item lines="none">
          <!-- Said rather than left to be discovered: the session survives, because the gateway's
               change-password does not revoke the token family. -->
          <ion-note>{{ 'me.changePasswordDetail' | translate }}</ion-note>
        </ion-item>
      </ion-list>

      <ion-alert
        [isOpen]="signOutBlocked()"
        [header]="'me.signOutBlocked' | translate"
        [message]="'me.signOutBlockedDetail' | translate"
        [buttons]="signOutButtons()"
        (didDismiss)="signOutBlocked.set(false)"
      ></ion-alert>
    </ion-content>
  `,
})
export class MePage implements OnInit {
  private readonly profiles = inject(ProfileApiService);
  private readonly notifications = inject(NotificationsApiService);
  readonly queue = inject(WriteQueue);
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

  // The fields the completion meter counts. See ClinicianProfileDto — these are what
  // OnboardingService requires for `profile`, `address` and `nextOfKin`.
  birthDate = '';
  sex = '';
  cardType = '';
  cardNumber = '';
  street = '';
  city = '';
  region = '';
  country = '';
  kinName = '';
  kinRelationship = '';
  kinPhone = '';

  /** Server enums. Never translated — see the note in the template. */
  readonly SEXES = ['FEMALE', 'MALE', 'UNSPECIFIED'];
  readonly CARD_TYPES = ['PASSPORT', 'NATIONAL_ID', 'DRIVERS_LICENSE'];

  readonly progress = signal<OnboardingProgressDto | null>(null);

  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  readonly changingPassword = signal(false);
  readonly passwordFailed = signal(false);
  readonly passwordMessage = signal<string | null>(null);

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

  private readonly accountApi = inject(AccountApiService);

  private profile: ClinicianProfileDto = {};

  ngOnInit(): void {
    this.loadPreferences();
    this.loadProgress();
    this.profiles.mine().subscribe({
      next: profile => {
        this.profile = profile ?? {};
        this.firstName = profile?.firstName ?? '';
        this.lastName = profile?.lastName ?? '';
        this.email = profile?.email ?? '';
        this.mobilePhone = profile?.mobilePhone ?? '';
        this.birthDate = profile?.birthDate ?? '';
        this.sex = profile?.sex ?? '';
        this.cardType = profile?.cardType ?? '';
        this.cardNumber = profile?.cardNumber ?? '';
        this.street = profile?.address?.streetAddress ?? '';
        this.city = profile?.address?.city ?? '';
        this.region = profile?.address?.region ?? '';
        this.country = profile?.address?.country ?? '';
        this.kinName = profile?.emergencyContact?.name ?? '';
        this.kinRelationship = profile?.emergencyContact?.relationship ?? '';
        this.kinPhone = profile?.emergencyContact?.phone ?? '';
      },
      // A clinician who has not completed onboarding has no profile yet; that is a normal state and
      // the form should simply start empty rather than shouting about it.
      error: () => this.loadFailed.set(true),
    });
  }

  /**
   * Reads the completion figure.
   *
   * <p>A failure is silent: an account with no application at all has no progress to report, and
   * that is an ordinary state for a clinician who was invited rather than one who applied. Showing
   * an error where a section simply does not apply would be noise.
   */
  private loadProgress(): void {
    this.profiles.progress().subscribe({
      next: progress => this.progress.set(progress),
      error: () => this.progress.set(null),
    });
  }

  /**
   * Changes the password.
   *
   * <p>Confirmation is checked here rather than server-side because the server has no second field
   * to compare against — it takes one new password and trusts the client to have asked twice. The
   * length bound is checked here too, so a rejection reads as a sentence rather than as a JHipster
   * problem document.
   *
   * <p>A 400 from the server means the <b>current</b> password was wrong, since length was already
   * ruled out. Saying so is the difference between a usable message and "Bad Request".
   */
  changePassword(): void {
    this.passwordMessage.set(null);
    this.passwordFailed.set(true);

    if (this.newPassword !== this.confirmPassword) {
      this.passwordMessage.set('me.passwordMismatch');
      return;
    }
    if (this.newPassword.length < PASSWORD_MIN_LENGTH || this.newPassword.length > PASSWORD_MAX_LENGTH) {
      this.passwordMessage.set('me.passwordLength');
      return;
    }

    this.changingPassword.set(true);
    this.accountApi.changePassword({ currentPassword: this.currentPassword, newPassword: this.newPassword }).subscribe({
      next: () => {
        this.changingPassword.set(false);
        this.passwordFailed.set(false);
        this.passwordMessage.set('me.passwordChanged');
        this.currentPassword = '';
        this.newPassword = '';
        this.confirmPassword = '';
      },
      error: () => {
        this.changingPassword.set(false);
        this.passwordFailed.set(true);
        this.passwordMessage.set('me.passwordWrong');
      },
    });
  }

  save(): void {
    this.saving.set(true);
    this.savedMessage.set(null);
    // Spread the loaded document so fields this page does not edit — identity card, address,
    // notification preferences — are preserved rather than blanked by a partial write.
    this.profiles
      .save({
        ...this.profile,
        firstName: this.firstName,
        lastName: this.lastName,
        email: this.email,
        mobilePhone: this.mobilePhone,
        birthDate: this.birthDate || undefined,
        sex: this.sex || undefined,
        cardType: this.cardType || undefined,
        cardNumber: this.cardNumber || undefined,
        // Nested documents are spread from the loaded profile so the optional fields this form does
        // not offer — town, district, digital address — survive a save rather than being blanked.
        address: {
          ...this.profile.address,
          streetAddress: this.street || undefined,
          city: this.city || undefined,
          region: this.region || undefined,
          country: this.country || undefined,
        },
        emergencyContact: {
          ...this.profile.emergencyContact,
          name: this.kinName || undefined,
          relationship: this.kinRelationship || undefined,
          phone: this.kinPhone || undefined,
        },
      })
      .subscribe({
        next: saved => {
          this.profile = saved ?? this.profile;
          this.saving.set(false);
          this.saveFailed.set(false);
          this.savedMessage.set('me.saved');
          // The meter is computed from what was just written, so it must be re-read rather than
          // left showing the figure from before the save.
          this.loadProgress();
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

  readonly signOutBlocked = signal(false);

  /** Built here rather than in the template so the labels go through the translate service. */
  readonly signOutButtons = computed(() => {
    this.language.current();
    return [
      { text: this.translate.instant('common.cancel'), role: 'cancel' },
      { text: this.translate.instant('me.signOutSendNow'), handler: () => void this.sendThenSignOut() },
      {
        text: this.translate.instant('me.signOutDiscardAndLeave'),
        role: 'destructive',
        handler: () => void this.discardAndSignOut(),
      },
    ];
  });

  /**
   * Signs out — unless there is unsent work, in which case it says so first.
   *
   * <p>`CacheStore.clear()` destroys the AES key the queue is sealed under, so signing out really
   * does discard unsent clinical notes. That is the right posture on a ward phone, where the
   * alternative is one clinician's note surviving into another's session — but it makes sign-out
   * destructive, and a destructive action has to be announced before it happens rather than
   * discovered afterwards.
   */
  signOut(): void {
    if (this.auth.hasUnsentWrites()) {
      this.signOutBlocked.set(true);
      return;
    }
    this.doSignOut();
  }

  /** Tries the queue again, then signs out only if it actually emptied. */
  async sendThenSignOut(): Promise<void> {
    await this.queue.drain();
    if (this.auth.hasUnsentWrites()) {
      return;
    }
    this.signOutBlocked.set(false);
    this.doSignOut();
  }

  /** The clinician chose to lose them. Explicit, never implicit. */
  async discardAndSignOut(): Promise<void> {
    await this.queue.discardAll();
    this.signOutBlocked.set(false);
    this.doSignOut();
  }

  async retryWrite(id: string): Promise<void> {
    await this.queue.retry(id);
  }

  async discardWrite(id: string): Promise<void> {
    await this.queue.discard(id);
  }

  private doSignOut(): void {
    // logout() is an ordered sequence — revoke the refresh family server-side while the token is
    // still valid, then wipe locally. AuthService owns that order; this only handles the UI after.
    this.auth.logout('user').subscribe(() => {
      this.accounts.clear();
      void this.nav.navigateRoot(['/login'], { replaceUrl: true });
    });
  }
}
