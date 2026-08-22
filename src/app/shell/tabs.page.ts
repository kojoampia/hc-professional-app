import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { IonIcon, IonLabel, IonTabBar, IonTabButton, IonTabs } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { documentTextOutline, chatbubblesOutline, personOutline, todayOutline } from 'ionicons/icons';

import { PushRegistrationService } from '../core/push/push-registration.service';
import { WriteQueue } from '../core/offline/write-queue.service';

/**
 * The four-tab shell: Today, Messages, Documents, Me.
 *
 * <p>Until MOB11 these were flat routes and the only way between them was a URL, which is fine for
 * a developer and useless on a phone. `app.routes.ts` carried a note saying they become tab
 * children here.
 *
 * <p>The icons are registered with `addIcons` rather than pulled from the global set: Ionicons only
 * ships what is asked for, and an unregistered name renders as an empty box with no error — which
 * on a tab bar looks like a broken build rather than a missing import.
 */
@Component({
  selector: 'hpd-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule, IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel],
  template: `
    <ion-tabs>
      <!--
        NO <ion-router-outlet> here. IonTabs renders its own internally and routes the tab children
        into it. Adding one looks harmless and even renders correctly — the pages appear, because
        they are in IonTabs' outlet — but the extra outlet is empty, spans the whole viewport and is
        painted last, so it sits on top and swallows every touch. The app then looks completely
        inert while nothing errors: taps do nothing, and element.click() from DevTools still works
        because it bypasses hit-testing. Cost a device debugging session; do not add it back.
      -->
      <ion-tab-bar slot="bottom">
        <ion-tab-button tab="today" data-test="tab-today">
          <ion-icon name="today-outline"></ion-icon>
          <ion-label>{{ 'tabs.today' | translate }}</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="messages" data-test="tab-messages">
          <ion-icon name="chatbubbles-outline"></ion-icon>
          <ion-label>{{ 'tabs.messages' | translate }}</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="documents" data-test="tab-documents">
          <ion-icon name="document-text-outline"></ion-icon>
          <ion-label>{{ 'tabs.documents' | translate }}</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="me" data-test="tab-me">
          <ion-icon name="person-outline"></ion-icon>
          <ion-label>{{ 'tabs.me' | translate }}</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  `,
})
export class TabsPage implements OnInit {
  private readonly pushRegistration = inject(PushRegistrationService);
  private readonly writeQueue = inject(WriteQueue);

  constructor() {
    addIcons({ todayOutline, chatbubblesOutline, documentTextOutline, personOutline });
  }

  /**
   * Register for push here, because this shell is exactly the signed-in surface (MOB10).
   *
   * <p>Not in `AppComponent`, which also runs for someone who has never signed in and would ask an
   * unauthenticated stranger for notification permission — a prompt you get one chance at on iOS,
   * and declining it is sticky. Not in the login page either: a restored session never passes
   * through it. `start()` is idempotent, so mounting this shell again costs nothing.
   */
  async ngOnInit(): Promise<void> {
    // The queue loads what a previous session left unsent and drains it. Started here for the same
    // reason push registration is: this shell is exactly the signed-in surface, and the queue is
    // sealed under a key that only exists once a session does.
    await this.writeQueue.start();
    await this.pushRegistration.start();
  }
}
