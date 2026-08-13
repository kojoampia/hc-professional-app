import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { addIcons } from 'ionicons';
import { close } from 'ionicons/icons';
import {
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonIcon,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonModal,
  IonNote,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  IonTextarea,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';

import { AccountService } from '../../core/auth/account.service';
import { LanguageService } from '../../core/i18n/language.service';
import { NetworkService } from '../../core/native/network.service';
import { describeAge } from '../../core/offline/cached-resource';
import { MessagesStore } from './messages.store';

/**
 * The inbox: threads, one open thread, and a reply box.
 *
 * Composing a *new* conversation is deliberately absent. `POST /api/messaging/conversations`
 * needs `recipientIds[]` or `recipientRole`, and the only directory endpoint is the
 * gateway's `PublicUserResource`, which returns every gateway user unfiltered — not
 * something to put behind a recipient picker on a clinical app. Reply-only until a
 * role-scoped directory endpoint exists; see MOB-P2-PRE in mobile-app-plan.md.
 */
@Component({
  selector: 'hpd-messages',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
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
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="pullToRefresh($event)">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>

      <div class="px-4 py-4 flex flex-col gap-3">
        @if (!network.connected() || store.conversations.status() === 'stale') {
          <p class="rounded-hpd-sm bg-hpd-warning-tint px-3 py-2 text-hpd-warning" role="status">
            {{ (network.connected() ? 'messages.savedData' : 'messages.savedDataOffline') | translate }} ·
            {{ 'today.updated' | translate }} {{ age() }}
          </p>
        }

        <ion-list [inset]="true">
          @for (conversation of conversations(); track conversation.id) {
            <ion-item button="true" (click)="open(conversation.id)">
              <ion-label>
                {{ conversation.subject || ('messages.noSubject' | translate) }}
                <p class="text-hpd-muted">{{ conversation.lastMessageAt | date: 'EEE d MMM, HH:mm' }}</p>
              </ion-label>
            </ion-item>
          } @empty {
            <ion-item lines="none">
              <ion-label class="text-hpd-muted">
                {{ (store.conversations.status() === 'error' ? 'messages.loadFailed' : 'messages.empty') | translate }}
              </ion-label>
            </ion-item>
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
                  {{ message.sentAt | date: 'HH:mm' }}
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
  private readonly accounts = inject(AccountService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);

  draft = '';
  readonly sending = signal(false);
  readonly sendError = signal(false);

  private readonly nowTick = signal(Date.now());
  readonly age = computed(() => describeAge(this.store.conversations.fetchedAt(), this.nowTick()));

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
    this.nowTick.set(Date.now());
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
      // No offline write queue in Phase 1, so a failed send must stay visible and
      // keep the draft rather than vanish.
      this.sendError.set(true);
    } finally {
      this.sending.set(false);
    }
  }

  async pullToRefresh(event: Event): Promise<void> {
    await this.store.refresh();
    this.nowTick.set(Date.now());
    (event as CustomEvent).detail?.complete?.();
  }
}
