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
  ViewWillEnter,
} from '@ionic/angular/standalone';

import {
  ClinicianProfileDto,
  EmergencyContactWriteDto,
  OnboardingProgressDto,
  ProfileApiService,
  toWireContact,
} from '../../core/api/profile-api.service';
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
export class MePage implements OnInit, ViewWillEnter {
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

  /**
   * Server enums. Never translated — see the note in the template.
   *
   * <h2>⛔ Three of these six values did not exist on the server, and now they would be REFUSED</h2>
   *
   * <p>`Profile.sex` and `Profile.cardType` were free-text `String` on the server, so this list was
   * never checked against anything and had drifted: `UNSPECIFIED`, `NATIONAL_ID` and
   * `DRIVERS_LICENSE` are in no enumeration `api/` has ever had. They stored and answered 200 —
   * which is the only reason nobody noticed.
   *
   * <p>F9 types both fields (`Sex` = `{FEMALE, MALE}`; `cardType` by `DocumentType`), so **an
   * invalid value is now a 400 on save** rather than a wrong value in the database. Corrected here
   * in the same unit as the server change: this app is store-gated and not yet published, so three
   * dropdown options that cannot be saved are fixable now and would not be later.
   *
   * <p>⚠ `CARD_TYPES` is the four government-identity types, which is exactly what `web/`'s
   * `IDENTITY_TYPES` offers on the same field — one dropdown, two apps, one list. It is **not** all
   * nine `DocumentType` members: a certificate is not a card somebody carries a number on.
   * ⛔ The link across to `api/`'s enums is made by hand, as it is for the shift vocabulary: mobile
   * CI clones one repo, so nothing here can read `net.jojoaddison.domain.enumeration.Sex`.
   */
  readonly SEXES = ['FEMALE', 'MALE'];
  readonly CARD_TYPES = ['PASSPORT', 'GHANACARD', 'DRIVERLICENSE', 'VOTERCARD'];

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
        // The card edits `contacts[0]` — the retired singular `emergencyContact` alias was a
        // projection of exactly this element, and this read is what let the server drop it (T6).
        const kin = profile?.contacts?.[0];
        this.kinName = kin?.name ?? '';
        this.kinRelationship = kin?.relationship ?? '';
        this.kinPhone = kin?.phone ?? '';
      },
      // A clinician who has not completed onboarding has no profile yet; that is a normal state and
      // the form should simply start empty rather than shouting about it.
      error: () => this.loadFailed.set(true),
    });
  }

  /**
   * Re-reads the completion figure every time this tab is entered — `backlog.md` row 230 unit C.
   *
   * <h2>⭐ Why a lifecycle hook and not the SSE stream `web/` consumes</h2>
   *
   * <p>Row 230 unit B gave `web/` a live push. <b>The owner's decision was that `mobile/` takes
   * none.</b> Mobile CI clones one repository, so that stream service cannot be shared — porting it
   * would be a second copy of a five-state machine with two reconnect operators and a flag leak that
   * took two review rounds to find, and this estate's own note is that <i>two correct-for-now copies
   * is how an estate arrives at one wrong one</i>. A held connection also costs battery and is killed
   * when the app backgrounds, so on a phone the push buys less than it does in a browser tab.
   *
   * <p>⭐ <b>And the staleness that actually bites here is a different one.</b> The figure was read in
   * `ngOnInit` only, and Ionic caches pages: a clinician who uploads a document on the Documents tab
   * and comes back here was shown the meter from whenever this page was first mounted. Fixing that
   * needs one hook, duplicates no state machine, and covers the one case a push would also have
   * covered on this screen.
   *
   * <h2>⚠ `ionViewWillEnter`, not `ngOnInit`, and the read lives here ALONE</h2>
   *
   * <p>`ionViewWillEnter` fires on <b>every</b> entry including the first, so keeping a copy of this
   * call in `ngOnInit` would issue two reads on first open. It is `willEnter` rather than
   * `didEnter` so the request starts before the transition animation rather than after it.
   *
   * <p>⭐ <b>That it fires at all is established at source rather than taken from the
   * documentation.</b> `tabs.page.ts` renders `<ion-tabs>` with no nested outlet, and in
   * `@ionic/angular@8.8.16` `StackController.createView` calls `bindLifecycleEvents`, which binds a
   * handler <b>iff</b> `typeof instance['ionViewWillEnter'] === 'function'`. This class declares it,
   * so the binding happens at view creation — before the first `setActive`, which is why the first
   * entry fires too.
   *
   * <p>⚠ <b>So the whole mechanism is one `typeof` check wide.</b> Rename this method and nothing
   * errors, nothing warns, and the meter quietly goes back to being read once per session.
   * `me.page.spec.ts` calls the hook by hand — TestBed drives no Ionic lifecycle — so that spec
   * cannot catch a rename either. The `ViewWillEnter` interface on the class declaration is what
   * does, and that is why it is implemented rather than left implicit.
   *
   * <p>⚠ <b>There was no precedent to follow, and this tab had no refresh at all.</b> Neither
   * `ionViewWillEnter` nor `ionViewDidEnter` appeared anywhere in this app, so this is the first
   * Ionic lifecycle hook in the repository. ⛔ And `ion-refresher` — the manual pull the other feature
   * pages offer — is in <b>seven of the eight</b> and <b>not in this one</b>: before this change the
   * figure was pinned to first mount for the rest of the session, with no gesture anywhere on the
   * screen that would move it. That makes the hook this tab's <i>only</i> refresh rather than a
   * convenience over a pull. The seven pages that do have a refresher still carry the same
   * cached-page staleness on entry, and closing it for them is not row 230's.
   *
   * <h2>⛔ A failed re-read keeps the figure on screen</h2>
   *
   * <p>A failure is silent — an account with no application at all has no progress to report, which
   * is ordinary for a clinician who was invited rather than one who applied, so an error where a
   * section does not apply would be noise. <b>But it no longer clears a figure that was there.</b>
   * Entering a tab on a phone that has just lost signal would otherwise blank the meter, and a blank
   * meter reads as "this does not apply to you" where a stale one reads as the number it is. The
   * trade is accepted in one direction only: a value this app already showed is kept, and an account
   * that never had one still renders nothing rather than 0%.
   */
  ionViewWillEnter(): void {
    this.loadProgress();
  }

  private loadProgress(): void {
    this.profiles.progress().subscribe({
      next: progress => this.progress.set(progress),
      // Deliberately writes nothing rather than set(null): see ionViewWillEnter's last paragraph.
      // The signal starts null, so a first read that fails still renders nothing.
      error: () => undefined,
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
    // The body is `ProfileDTO`'s vocabulary, NOT the loaded document's — see ProfileApiService's
    // class note. ⛔ Do not reinstate the old `...this.profile` spread: the loaded document is the
    // read shape, whose `mobilePhone` and `contacts[].phone` the PUT silently drops — and a
    // read-shape `contacts` list would blank every stored number with a 200. The PUT is a partial
    // write, so fields this page does not edit survive by being absent, not by being echoed.
    this.profiles
      .save({
        firstName: this.firstName,
        lastName: this.lastName,
        email: this.email,
        // `mobileNumber` on the write for the document's `mobilePhone` on the read.
        mobileNumber: this.mobilePhone,
        birthDate: this.birthDate || undefined,
        sex: this.sex || undefined,
        cardType: this.cardType || undefined,
        cardNumber: this.cardNumber || undefined,
        // Address replaces wholesale on the server, so it alone is spread from the loaded profile:
        // the optional fields this form does not offer — town, district, digital address — must
        // travel back or be blanked. Its field names match on both shapes.
        address: {
          ...this.profile.address,
          streetAddress: this.street || undefined,
          city: this.city || undefined,
          region: this.region || undefined,
          country: this.country || undefined,
        },
        contacts: this.contactsForSave(),
      })
      .subscribe({
        next: saved => {
          this.profile = saved ?? this.profile;
          this.saving.set(false);
          this.saveFailed.set(false);
          this.savedMessage.set('me.saved');
          // The meter is computed from what was just written, so it must be re-read rather than
          // left showing the figure from before the save. ⭐ This predates row 230 unit C and is
          // why a clinician who fills in next-of-kin HERE sees the percentage move without leaving
          // the tab: the hook covers entering, this covers saving, and between them the meter is
          // never stale on this screen. A review of unit C read the hook as the only refresh and
          // filed the on-tab save as a gap; it is not, and the premise is recorded here because
          // the two call sites are 100 lines apart and neither names the other.
          this.loadProgress();
        },
        error: () => {
          this.saving.set(false);
          this.saveFailed.set(true);
          this.savedMessage.set('me.saveFailed');
          // ⛔ Deliberately NO re-read. Nothing was written, so the figure cannot have moved, and a
          // GET here would replace a number the clinician can still act on with whatever the
          // network is managing at the moment it already failed a PUT.
        },
      });
  }

  /**
   * The stored contact list with element 0 replaced by what the card holds, every element in the
   * PUT vocabulary (`phoneNumber`).
   *
   * <p>⛔ **Never a one-element list.** The server replaces `contacts` wholesale, so sending only the
   * card's contact would erase the others — the exact silent loss the deprecated alias was kept
   * alive to prevent (profile-addendum.md § 3 T6). The card edits `contacts[0]`; the rest travel
   * back untouched, translated so their numbers survive the vocabulary change.
   *
   * <p>`undefined` when there is nothing stored and nothing typed: the server distinguishes "the
   * caller sent no contacts" (leave as stored) from "the caller sent an empty list", and a save that
   * always named the field would store one empty contact for every clinician who never filled the
   * card in.
   */
  private contactsForSave(): EmergencyContactWriteDto[] | undefined {
    const stored = this.profile.contacts ?? [];
    if (stored.length === 0 && !this.kinName && !this.kinRelationship && !this.kinPhone) {
      return undefined;
    }
    const [first, ...rest] = stored.map(toWireContact);
    return [
      {
        ...first,
        name: this.kinName || undefined,
        relationship: this.kinRelationship || undefined,
        phoneNumber: this.kinPhone || undefined,
      },
      ...rest,
    ];
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
