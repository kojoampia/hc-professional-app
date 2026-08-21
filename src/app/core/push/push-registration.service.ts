import { Injectable, effect, inject } from '@angular/core';
import { NavController } from '@ionic/angular/standalone';
import { firstValueFrom } from 'rxjs';

import { NotificationsApiService } from '../api/notifications-api.service';
import { LanguageService } from '../i18n/language.service';
import { PlatformService } from '../native/platform.service';
import { PushService } from '../native/push.service';
import { MessagesStore } from '../../features/messages/messages.store';

/** Ships in the registration so the server can tell an old client from a new one. */
const APP_VERSION = '0.1.0';

/**
 * Connects the push plugin to the rest of the app (MOB10).
 *
 * <p>`PushService` is the plugin wrapper and stays that: permissions, listeners, tokens. This is the
 * part that decides what those events mean — where the token goes, what a tap opens, and what a
 * foreground receipt does. Since MOB1 the wrapper has carried an `onToken` callback and a comment
 * saying MOB10 posts it; nothing called it, so the server could send notifications and the app could
 * not receive them.
 *
 * <h3>A foreground receipt shows nothing</h3>
 * The server sends push **and** STOMP for every message — it cannot know whether a socket is live,
 * and guessing produces missed notifications. So a foreground push is not news: it refreshes the
 * badge through the same {@link MessagesStore.onNotification} the socket uses, and that method's LRU
 * of the last 200 message ids is what stops the pair being counted twice. Raising a tray row here
 * would double every notification the user is already looking at.
 *
 * <h3>Why a tap navigates rather than opening the thread directly</h3>
 * `MessagesStore.openThread` on its own would leave the user on whatever tab they were on with a
 * thread loaded behind it. The tap targets `/messages` with the conversation as a query parameter
 * and the page opens it — one place that knows how to present a thread, whether it was reached by
 * tapping a notification or by tapping the tab.
 *
 * <h3>Where deregistration lives</h3>
 * Not here: {@link AuthService} owns it, because sign-out is an ordered sequence and the DELETE has
 * to go out while the access token is still valid. Putting it here would also drag the whole
 * messaging graph into the auth path, which is constructed at app start.
 */
@Injectable({ providedIn: 'root' })
export class PushRegistrationService {
  private readonly push = inject(PushService);
  private readonly api = inject(NotificationsApiService);
  private readonly language = inject(LanguageService);
  private readonly platform = inject(PlatformService);
  private readonly messages = inject(MessagesStore);
  private readonly nav = inject(NavController);

  private started = false;
  /** The langKey the server currently believes this device wants. */
  private registeredLanguage: string | null = null;
  /** The last token successfully sent to the server, so sign-out can be recognised. */
  private lastToken: string | null = null;

  constructor() {
    // A language change has to reach the server, because the tray text is composed there. Without
    // this, someone who switches to German keeps receiving English notifications until they
    // reinstall — and every screen in the app would be German, so nothing would look wrong.
    effect(() => {
      const language = this.language.current();
      const token = this.push.token();
      if (token && this.registeredLanguage !== null && this.registeredLanguage !== language) {
        void this.send(token, language);
      }
    });
  }

  /**
   * Asks for permission, registers, and wires the listeners. Idempotent.
   *
   * @returns false on the web, where `@capacitor/push-notifications` has no implementation, and when
   *   the user declines. Neither is an error: notifications are a convenience and STOMP still
   *   delivers everything while the app is open.
   */
  async start(): Promise<boolean> {
    // Re-arm after a sign-out. `AuthService.endSession` calls `PushService.unregister()`, which
    // removes the listeners this wired and clears the token — so a token that WAS registered and is
    // now gone means the next clinician on this handset needs a fresh registration. Checked here,
    // on the call TabsPage makes every time the signed-in shell mounts, rather than in an effect:
    // an effect only observes what it happens to be flushed for, and missing the transition would
    // leave the second clinician receiving nothing at all, silently.
    if (this.lastToken !== null && this.push.token() === null) {
      this.started = false;
      this.lastToken = null;
      this.registeredLanguage = null;
    }
    if (this.started) {
      return true;
    }
    this.started = true;

    return this.push.register({
      onToken: token => void this.send(token, this.language.current()),
      onReceived: notification => void this.onReceived(notification.data as Record<string, string> | undefined),
      onActionPerformed: action => void this.onTapped(action.notification.data as Record<string, string> | undefined),
    });
  }

  /** Foreground: refresh what the badge shows, show nothing. */
  private async onReceived(data: Record<string, string> | undefined): Promise<void> {
    const messageId = data?.['messageId'];
    if (messageId) {
      await this.messages.onNotification(messageId);
    }
  }

  /** Background tap: open the thread it came from. */
  private async onTapped(data: Record<string, string> | undefined): Promise<void> {
    const conversationId = data?.['conversationId'];
    if (!conversationId) {
      // A compliance alert has no thread to open. The Documents tab is where it is actioned.
      await this.nav.navigateRoot(['/documents']);
      return;
    }
    await this.nav.navigateRoot(['/messages'], { queryParams: { conversation: conversationId } });
  }

  private async send(token: string, language: string): Promise<void> {
    try {
      await firstValueFrom(
        this.api.register({
          token,
          // Upper case because the server matches `IOS` to choose APNs over FCM; `Capacitor.getPlatform()`
          // answers lower case.
          platform: this.platform.name().toUpperCase(),
          appVersion: APP_VERSION,
          langKey: language,
        }),
      );
      this.registeredLanguage = language;
      this.lastToken = token;
    } catch {
      // The token is reissued on every launch, so a failed registration costs this session's
      // notifications and nothing more. Failing loudly here would put an error in front of a
      // clinician for something they cannot act on.
    }
  }
}
