import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

import { RelativeTime } from '../core/i18n/relative-time.service';
import { NetworkService } from '../core/native/network.service';
import { ResourceStatus } from '../core/offline/cached-resource';

/**
 * "You are looking at saved data, and here is how old it is."
 *
 * <p>This markup existed four times — Today, Messages, Documents, Roster — pasted, with the
 * staleness check, the network check, the age computation and the `nowTick` signal duplicated at
 * each site. That is the one thing in this app worth extracting: not because four copies are
 * expensive, but because the <em>wording decision</em> was being made four times. Offline and stale
 * are different states and were phrased inconsistently, and a fifth screen would have made a fifth
 * choice.
 *
 * <p><b>It does not decide whether data is shown.</b> The offline cache always serves what it has —
 * a roster that vanishes when the signal does is worse than useless, since the data is still correct
 * and only old. This says so; it never gates.
 *
 * <p>Deliberately NOT a port of `web/`'s `hpd-async-state`. That component wraps content and swaps
 * it for a loading or error view, which is the right shape for a desktop app that starts empty and
 * fills in. This app starts from cache, so `loading` is nearly unreachable and an error means "there
 * is nothing at all", not "try again".
 */
@Component({
  selector: 'hpd-async-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule],
  template: `
    @if (message(); as key) {
      <p class="rounded-hpd-sm bg-hpd-warning-tint px-3 py-2 text-hpd-warning" role="status" data-test="async-banner">
        {{ key | translate }} · {{ 'today.updated' | translate }} {{ age() }}
      </p>
    }
  `,
})
export class AsyncBannerComponent {
  private readonly network = inject(NetworkService);
  private readonly relativeTime = inject(RelativeTime);

  /** The resource's own status. Only `stale` produces a banner; `error` is the empty state's job. */
  readonly status = input.required<ResourceStatus>();

  /** When the data was last fetched, for the age. */
  readonly fetchedAt = input<number | null>(null);

  /**
   * Translation key for the stale-but-online case.
   *
   * <p>Passed in rather than fixed, because each screen names its own data — "showing saved
   * documents" reads better than "showing saved data" on the Documents tab. The offline variant is
   * derived by convention (`…Offline`), which is how all four screens already spelled it.
   */
  readonly savedDataKey = input('today.savedData');

  /**
   * The clock the age is measured against.
   *
   * <p>Re-stamped whenever `fetchedAt` changes, which is the moment a refresh landed. It used to be
   * set once at construction and re-stamped by a public `markRefreshed()` that hosts were expected
   * to call after a pull-to-refresh — **and not one of the five hosts called it**, so the age was
   * measured against whenever the banner happened to be created. The method was dead code and the
   * behaviour it existed to provide never happened.
   *
   * <p>Doing it here rather than asking hosts to remember is the point: an API that five callers
   * must each remember to call is one that will be wrong again the next time a screen is added.
   */
  private readonly nowTick = signal(Date.now());

  readonly age = computed(() => this.relativeTime.describe(this.fetchedAt(), this.nowTick()));

  constructor() {
    // A landed refresh moves `fetchedAt`; the age must be measured from now, not from whenever this
    // banner was constructed. Without it a screen left open for hours shows "updated 3 h ago"
    // immediately after a successful pull-to-refresh.
    effect(() => {
      this.fetchedAt();
      this.nowTick.set(Date.now());
    });
  }

  /**
   * Which message to show, or none.
   *
   * <p>Offline wins over stale: a clinician who has lost signal needs to know that first, and the
   * data being old is the consequence rather than the news.
   */
  readonly message = computed(() => {
    if (!this.network.connected()) {
      return `${this.savedDataKey()}Offline`;
    }
    return this.status() === 'stale' ? this.savedDataKey() : null;
  });
}
