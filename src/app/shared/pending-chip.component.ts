import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { IonBadge } from '@ionic/angular/standalone';

import { QueuedWriteState } from '../core/offline/queued-write.model';

/**
 * Marks an entry that has not reached the server.
 *
 * <p><b>Why marked and not merged.</b> `web/`'s repository writes an optimistic entry into its cache
 * indistinguishably from a saved one. That is fine at an 80 ms round trip on a desk. It is not fine
 * on a phone that may hold the write for hours: a clinician scrolling a record cannot be shown
 * something that looks filed and is not, because the whole value of the record is that it says what
 * happened.
 *
 * <p>So a queued entry renders with this chip and a distinct left border, and is excluded from any
 * count, export or share — nothing unsent leaves the app.
 */
@Component({
  selector: 'hpd-pending-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule, IonBadge],
  template: ` <ion-badge [color]="colour()" data-test="pending-chip">{{ key() | translate }}</ion-badge> `,
})
export class PendingChipComponent {
  readonly state = input.required<QueuedWriteState>();

  readonly colour = computed(() => {
    switch (this.state()) {
      case 'conflict':
      case 'rejected':
      case 'expired':
        return 'danger';
      default:
        return 'warning';
    }
  });

  readonly key = computed(() => {
    switch (this.state()) {
      case 'conflict':
        return 'common.pendingConflict';
      case 'rejected':
        return 'common.pendingRejected';
      case 'expired':
        return 'common.pendingExpired';
      default:
        return 'common.pendingUnsent';
    }
  });
}
