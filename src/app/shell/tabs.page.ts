import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { IonIcon, IonLabel, IonRouterOutlet, IonTabBar, IonTabButton, IonTabs } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { documentTextOutline, chatbubblesOutline, personOutline, todayOutline } from 'ionicons/icons';

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
  imports: [TranslateModule, IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, IonRouterOutlet],
  template: `
    <ion-tabs>
      <ion-router-outlet></ion-router-outlet>

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
export class TabsPage {
  constructor() {
    addIcons({ todayOutline, chatbubblesOutline, documentTextOutline, personOutline });
  }
}
