import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import { close } from 'ionicons/icons';
import {
  IonAlert,
  IonBadge,
  IonButton,
  IonButtons,
  IonCheckbox,
  IonContent,
  IonFooter,
  IonIcon,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
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

import { AccountService } from '../../core/auth/account.service';
import { LanguageService } from '../../core/i18n/language.service';
import { RelativeTime } from '../../core/i18n/relative-time.service';
import { AsyncBannerComponent } from '../../shared/async-banner.component';
import { EmptyRowComponent } from '../../shared/empty-row.component';
import { NetworkService } from '../../core/native/network.service';

import { RecipientDto } from '../../core/api/messaging-api.service';
import { MessagesStore } from './messages.store';

/**
 * The inbox: threads, one open thread, a reply box, and — since Phase 8 — composing a new one.
 *
 * <h3>Why composing was absent until now</h3>
 * `POST /api/messaging/conversations` needs `recipientIds[]` or `recipientRole`, and the only
 * directory endpoint was the gateway's `PublicUserResource`, which returns every gateway user
 * unfiltered — including accounts that are not clinicians at all. That is not something to put
 * behind a recipient picker on a clinical app, so this was reply-only. `GET /api/messaging/recipients`
 * closed it: role-scoped, and sourced from the same records the broadcast resolves against, so the
 * picker and the broadcast cannot disagree about who exists.
 *
 * <h3>A broadcast states its count before it sends</h3>
 * "This goes to 14 nurses." The clinician cannot otherwise see who they are addressing, and a role
 * matching nobody is a real case — a typo, or a role whose last holder was deactivated. The server
 * refuses that with 422, but being told the number beforehand is better than a rejection after.
 * `web/`'s equivalent is a free-text box of logins with no confirmation at all.
 *
 * <h3>Reading a thread clears that thread</h3>
 * Not every thread. Until Phase 1 the only endpoints were one message or everything, and this took
 * everything, so opening one conversation cleared every unread badge in the app and a clinician
 * lost the signal that three others were waiting.
 */
@Component({
  selector: 'hpd-messages',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AsyncBannerComponent,
    EmptyRowComponent,
    TranslateModule,
    DatePipe,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonIcon,
    IonFooter,
    IonRefresher,
    IonRefresherContent,
    IonList,
    IonItem,
    IonLabel,
    IonNote,
    IonBadge,
    IonModal,
    IonTextarea,
    IonSpinner,
    IonAlert,
    IonCheckbox,
    IonInput,
    IonSearchbar,
    IonSegment,
    IonSegmentButton,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ 'messages.title' | translate }}</ion-title>
        @if (store.unread.value(); as count) {
          @if (count > 0) {
            <ion-badge slot="end" color="gold" class="mr-3">{{ count }}</ion-badge>
          }
        }
        <ion-buttons slot="end">
          <ion-button (click)="openCompose()" data-test="open-compose">{{ 'messages.compose' | translate }}</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="pullToRefresh($event)">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>

      <div class="px-4 py-4 flex flex-col gap-3">
        <hpd-async-banner
          [status]="store.conversations.status()"
          [fetchedAt]="store.conversations.fetchedAt()"
          savedDataKey="messages.savedData"
        ></hpd-async-banner>

        <ion-list [inset]="true">
          @for (conversation of conversations(); track conversation.id) {
            <ion-item button="true" (click)="open(conversation.id)">
              <ion-label>
                {{ conversation.subject || ('messages.noSubject' | translate) }}
                <p class="text-hpd-muted">{{ conversation.lastMessageAt | date: 'EEE d MMM, HH:mm' : undefined : locale() }}</p>
              </ion-label>
            </ion-item>
          } @empty {
            <hpd-empty-row
              [status]="store.conversations.status()"
              emptyKey="messages.empty"
              failedKey="messages.loadFailed"
            ></hpd-empty-row>
          }
        </ion-list>
      </div>

      <!-- A thread is a bottom sheet, not a page: it is a peek at a conversation, and
           dismissing it should not unwind a navigation stack. -->
    </ion-content>

    <!--
      A full-screen modal, deliberately NOT a sheet. As a sheet at initialBreakpoint 0.9 the wrapper
      is still full height and merely translated down ~10%, so its bottom ~80px sits below the
      viewport — and that is exactly where the reply composer lives. The thread rendered, and
      replying was impossible because the textarea and Send button were off-screen with nothing to
      indicate it. A conversation is a full-screen task anyway; the sheet bought nothing.
    -->
    <ion-modal [isOpen]="store.openConversationId() !== null" (ionModalDidDismiss)="close()">
      <ng-template>
        <ion-header>
          <ion-toolbar>
            <ion-title>{{ openSubject() }}</ion-title>
            <ion-buttons slot="end">
              <ion-button (click)="close()" [attr.aria-label]="'messages.close' | translate">
                <ion-icon slot="icon-only" name="close"></ion-icon>
              </ion-button>
            </ion-buttons>
          </ion-toolbar>
        </ion-header>
        <ion-content>
          <div class="px-4 py-4 flex flex-col gap-3">
            @for (message of store.thread(); track message.id) {
              <div [class]="isMine(message.senderId) ? 'self-end max-w-[85%]' : 'self-start max-w-[85%]'">
                <div
                  class="rounded-hpd px-3 py-2"
                  [class]="isMine(message.senderId) ? 'bg-hpd-primary text-white' : 'bg-white border border-hpd-border'"
                >
                  {{ message.body }}
                </div>
                <p class="mt-1 text-hpd-subtle" [class.text-right]="isMine(message.senderId)">
                  {{ isMine(message.senderId) ? ('messages.me' | translate) : message.senderName ?? message.senderId }} ·
                  {{ message.sentAt | date: 'HH:mm' : undefined : locale() }}
                </p>
              </div>
            } @empty {
              <p class="text-hpd-muted">{{ 'messages.threadEmpty' | translate }}</p>
            }
          </div>
        </ion-content>
        <ion-footer>
          <ion-toolbar>
            <div class="flex items-end gap-2 px-3 py-2">
              <ion-textarea
                [(ngModel)]="draft"
                placeholder="{{ 'messages.replyPlaceholder' | translate }}"
                [autoGrow]="true"
                [rows]="1"
                fill="outline"
                class="flex-1"
              ></ion-textarea>
              <button class="hpd-btn hpd-btn-primary hpd-focusable" [disabled]="sending() || !draft.trim()" (click)="send()">
                @if (sending()) {
                  <ion-spinner name="crescent"></ion-spinner>
                } @else {
                  {{ 'messages.send' | translate }}
                }
              </button>
            </div>
            @if (sendError()) {
              <p class="px-3 pb-2 text-hpd-danger" role="alert">{{ 'messages.sendFailed' | translate }}</p>
            }
          </ion-toolbar>
        </ion-footer>
      </ng-template>
    </ion-modal>

    <!-- Full screen for the same measured reason as the thread: as a sheet the composer's own
         send button sits below the viewport. -->
    <ion-modal [isOpen]="composing()" (ionModalDidDismiss)="composing.set(false)">
      <ng-template>
        <ion-header>
          <ion-toolbar>
            <ion-title>{{ 'messages.compose' | translate }}</ion-title>
            <ion-buttons slot="end">
              <button class="hpd-btn hpd-btn-ghost hpd-focusable" (click)="composing.set(false)">
                {{ 'messages.close' | translate }}
              </button>
            </ion-buttons>
          </ion-toolbar>
        </ion-header>
        <ion-content class="ion-padding">
          @if (composeError(); as error) {
            <p class="mb-3 rounded-hpd-sm bg-hpd-danger-tint px-3 py-2 text-hpd-danger" role="alert" data-test="compose-error">
              {{ error | translate }}
            </p>
          }

          <ion-segment [value]="composeRole ? 'role' : 'people'" (ionChange)="switchMode($any($event).detail.value)">
            <ion-segment-button value="people">{{ 'messages.toPeople' | translate }}</ion-segment-button>
            <ion-segment-button value="role">{{ 'messages.toRole' | translate }}</ion-segment-button>
          </ion-segment>

          @if (composeRole) {
            <ion-list [inset]="true">
              @for (role of broadcastRoles; track role) {
                <ion-item button (click)="composeRole = role" [attr.data-test]="'role-' + role">
                  <ion-label>
                    <!-- A server enum, deliberately untranslated: a role must read the same here as
                         in the administrator's console, or the two describe one audience two ways. -->
                    <h3>{{ role }}</h3>
                  </ion-label>
                  @if (composeRole === role) {
                    <ion-badge slot="end" color="gold">{{ 'messages.selected' | translate }}</ion-badge>
                  }
                </ion-item>
              }
            </ion-list>
          } @else {
            <ion-searchbar
              [placeholder]="'messages.searchRecipients' | translate"
              [debounce]="300"
              (ionInput)="searchRecipients($any($event).detail.value)"
              data-test="recipient-search"
            ></ion-searchbar>

            @if (chosen().length > 0) {
              <ion-list [inset]="true">
                @for (recipient of chosen(); track recipient.accountId) {
                  <ion-item button (click)="toggleRecipient(recipient)">
                    <ion-label
                      ><h3>{{ recipient.displayName }}</h3>
                      <p>{{ recipient.role }}</p></ion-label
                    >
                    <ion-badge slot="end" color="gold">{{ 'messages.selected' | translate }}</ion-badge>
                  </ion-item>
                }
              </ion-list>
            }

            <ion-list [inset]="true">
              @for (recipient of matches(); track recipient.accountId) {
                <ion-item button (click)="toggleRecipient(recipient)" [attr.data-test]="'recipient-' + recipient.accountId">
                  <ion-checkbox slot="start" [checked]="isChosen(recipient)"></ion-checkbox>
                  <ion-label
                    ><h3>{{ recipient.displayName }}</h3>
                    <p>{{ recipient.role }}</p></ion-label
                  >
                </ion-item>
              } @empty {
                <ion-item lines="none"
                  ><ion-note>{{ 'messages.searchHint' | translate }}</ion-note></ion-item
                >
              }
            </ion-list>
          }

          <ion-list [inset]="true">
            <ion-item>
              <ion-input
                label="{{ 'messages.subject' | translate }}"
                labelPlacement="stacked"
                [(ngModel)]="composeSubject"
                data-test="compose-subject"
              ></ion-input>
            </ion-item>
            <ion-item>
              <ion-textarea
                label="{{ 'messages.body' | translate }}"
                labelPlacement="stacked"
                [autoGrow]="true"
                [rows]="4"
                [(ngModel)]="composeBody"
                data-test="compose-body"
              ></ion-textarea>
            </ion-item>
            <ion-item lines="none">
              <button
                class="hpd-btn hpd-btn-primary hpd-btn-block hpd-focusable"
                [disabled]="sending()"
                (click)="submitCompose()"
                data-test="compose-submit"
              >
                {{ 'messages.composeSend' | translate }}
              </button>
            </ion-item>
            <ion-item lines="none">
              <ion-note>{{ 'messages.composeQueued' | translate }}</ion-note>
            </ion-item>
          </ion-list>
        </ion-content>
      </ng-template>
    </ion-modal>

    <ion-alert
      [isOpen]="confirmingBroadcast()"
      [header]="'messages.broadcastConfirm' | translate"
      [message]="'messages.broadcastCount' | translate: { count: broadcastCount(), role: composeRole }"
      [buttons]="broadcastButtons()"
      (didDismiss)="confirmingBroadcast.set(false)"
    ></ion-alert>
  `,
})
export class MessagesPage implements OnInit {
  constructor() {
    // Registered explicitly: Ionicons only ships what is asked for, and an unregistered name
    // renders as an empty box with no error — on a dismiss control that reads as a dead button.
    addIcons({ close });
  }

  readonly store = inject(MessagesStore);
  readonly network = inject(NetworkService);
  private readonly relativeTime = inject(RelativeTime);
  private readonly accounts = inject(AccountService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  /** DatePipe formats through LOCALE_ID, which ngx-translate does not touch — pass it explicitly. */
  readonly locale = this.language.current;

  draft = '';
  readonly sending = signal(false);
  readonly sendError = signal(false);

  readonly composing = signal(false);
  readonly composeError = signal<string | null>(null);
  composeSubject = '';
  composeBody = '';
  composeRole = '';
  readonly matches = signal<readonly RecipientDto[]>([]);
  readonly chosen = signal<readonly RecipientDto[]>([]);
  readonly confirmingBroadcast = signal(false);
  readonly broadcastCount = signal(0);

  /**
   * The nine clinical authorities, as broadcast targets.
   *
   * <p>Values are server enums and are NOT translated — a role a clinician broadcasts to must read
   * the same on the phone as in the administrator's console, or the two describe the same audience
   * differently.
   */
  readonly broadcastRoles = ['ROLE_DOCTOR', 'ROLE_NURSE', 'ROLE_PARAMEDIC', 'ROLE_PHARMACIST', 'ROLE_THERAPIST'];

  readonly broadcastButtons = computed(() => [
    { text: this.translate.instant('common.cancel'), role: 'cancel' },
    { text: this.translate.instant('messages.composeSend'), handler: () => void this.reallySend() },
  ]);

  readonly conversations = computed(() =>
    [...(this.store.conversations.value() ?? [])].sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '')),
  );

  readonly openSubject = computed(() => {
    const id = this.store.openConversationId();
    // Reading the active language makes this recompute on a language change; `instant` is not
    // reactive the way the pipe is. Same reason as TodayPage.t().
    this.language.current();
    return this.conversations().find(c => c.id === id)?.subject || this.translate.instant('messages.conversation');
  });

  async ngOnInit(): Promise<void> {
    await this.store.start();
    this.openFromNotificationTaps();
  }

  /**
   * Opens the thread a tapped push notification named (MOB10).
   *
   * <p>Subscribed rather than read once from the snapshot: this page is a tab, so a second tap
   * while it is already mounted re-uses the component and `ngOnInit` does not run again. Reading
   * the snapshot alone works exactly once per visit to the tab, which is the kind of bug that
   * survives testing — the first notification always opens the right thread.
   */
  private openFromNotificationTaps(): void {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const conversationId = params.get('conversation');
      if (conversationId && conversationId !== this.store.openConversationId()) {
        void this.open(conversationId);
      }
    });
  }

  isMine(senderId: string | undefined): boolean {
    return senderId !== undefined && senderId === this.accounts.account()?.login;
  }

  async open(conversationId: string): Promise<void> {
    this.draft = '';
    this.sendError.set(false);
    await this.store.openThread(conversationId);
  }

  close(): void {
    this.store.closeThread();
  }

  /**
   * Sends a reply — or rather queues one.
   *
   * <p>The draft is cleared because the reply is <b>kept</b>, not lost: the queue holds it and
   * sends it when there is signal. That is a different thing from the Phase 1 behaviour this
   * replaces, where a failed send kept the draft on screen because there was nowhere else for it
   * to go.
   */
  async send(): Promise<void> {
    if (this.sending() || !this.draft.trim()) {
      return;
    }
    this.sending.set(true);
    this.sendError.set(false);
    try {
      await this.store.reply(this.draft);
      this.draft = '';
    } catch {
      // Submitting to the queue is local and does not fail on a network problem, so reaching here
      // means the queue itself refused — keep the draft and say so.
      this.sendError.set(true);
    } finally {
      this.sending.set(false);
    }
  }

  // ---- Composing a new conversation ----------------------------------------------------------

  /** Switching mode clears the other mode's selection — a message goes to people or to a role. */
  switchMode(mode: string): void {
    if (mode === 'role') {
      this.chosen.set([]);
      this.matches.set([]);
      this.composeRole = this.broadcastRoles[0];
    } else {
      this.composeRole = '';
    }
  }

  openCompose(): void {
    this.composeSubject = '';
    this.composeBody = '';
    this.composeRole = '';
    this.chosen.set([]);
    this.matches.set([]);
    this.composeError.set(null);
    this.composing.set(true);
  }

  /** Searches the role-scoped directory. Never the gateway's user list — see the API service. */
  async searchRecipients(query: string | null | undefined): Promise<void> {
    const term = (query ?? '').trim();
    this.matches.set(term.length < 2 ? [] : await this.store.recipients(term));
  }

  toggleRecipient(recipient: RecipientDto): void {
    this.chosen.update(current =>
      current.some(c => c.accountId === recipient.accountId)
        ? current.filter(c => c.accountId !== recipient.accountId)
        : [...current, recipient],
    );
  }

  isChosen(recipient: RecipientDto): boolean {
    return this.chosen().some(c => c.accountId === recipient.accountId);
  }

  /**
   * Starts the send, confirming a broadcast first.
   *
   * <p>A role broadcast is confirmed with the <b>count</b> — "this goes to 14 nurses" — because the
   * clinician cannot otherwise see who they are addressing, and because a role that matches nobody
   * is a real case: the server refuses it with 422, but finding that out after tapping send is
   * worse than being told the number before.
   */
  async submitCompose(): Promise<void> {
    this.composeError.set(null);
    if (!this.composeBody.trim()) {
      this.composeError.set('messages.composeNeedsBody');
      return;
    }
    if (!this.composeRole && this.chosen().length === 0) {
      this.composeError.set('messages.composeNeedsRecipient');
      return;
    }

    if (this.composeRole) {
      const holders = await this.store.recipients(undefined, this.composeRole);
      if (holders.length === 0) {
        // The server would answer 422. Saying so here spares the clinician a send that cannot work.
        this.composeError.set('messages.composeRoleEmpty');
        return;
      }
      this.broadcastCount.set(holders.length);
      this.confirmingBroadcast.set(true);
      return;
    }

    await this.reallySend();
  }

  async reallySend(): Promise<void> {
    this.confirmingBroadcast.set(false);
    this.sending.set(true);
    try {
      await this.store.startConversation({
        subject: this.composeSubject.trim() || undefined,
        body: this.composeBody,
        recipientIds: this.composeRole ? undefined : this.chosen().map(c => c.accountId),
        recipientRole: this.composeRole || undefined,
      });
      this.composing.set(false);
    } catch {
      this.composeError.set('messages.composeFailed');
    } finally {
      this.sending.set(false);
    }
  }

  async pullToRefresh(event: Event): Promise<void> {
    await this.store.refresh();
    (event as CustomEvent).detail?.complete?.();
  }
}
