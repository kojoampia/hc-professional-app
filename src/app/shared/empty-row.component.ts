import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { IonItem, IonLabel } from '@ionic/angular/standalone';

import { ResourceStatus } from '../core/offline/cached-resource';

/**
 * The row inside an `@empty` block, which says one of two quite different things.
 *
 * <p>"Nothing rostered in the next 7 days" and "Could not load your roster" look identical in the
 * DOM — an inset list with one muted row — and mean opposite things to a clinician. One is
 * information; the other is a failure they can act on by finding signal. This existed four times,
 * with the ternary rewritten each time, which is four chances to get the branch backwards.
 *
 * <p>Only `error` shows the failure text. `stale` deliberately does not: stale data is still shown,
 * and if a stale list happens to be empty then it is genuinely empty as far as anyone knows.
 */
@Component({
  selector: 'hpd-empty-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule, IonItem, IonLabel],
  template: `
    <ion-item lines="none">
      <ion-label [class]="status() === 'error' ? 'text-hpd-danger' : 'text-hpd-muted'" data-test="empty-row">
        {{ key() | translate }}
      </ion-label>
    </ion-item>
  `,
})
export class EmptyRowComponent {
  readonly status = input.required<ResourceStatus>();

  /** What to say when there is simply nothing. */
  readonly emptyKey = input.required<string>();

  /** What to say when the list is empty because the read failed. */
  readonly failedKey = input.required<string>();

  readonly key = computed(() => (this.status() === 'error' ? this.failedKey() : this.emptyKey()));
}
