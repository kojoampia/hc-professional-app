import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

import { OnboardingProgressDto } from '../core/api/profile-api.service';

/**
 * How far this clinician is from being activated, and what is still missing.
 *
 * <p>Ported from `web/src/main/webapp/app/account/profile/completion-meter.component.ts`. It is the
 * one thing in the whole app that tells a restricted clinician <b>why</b> — everything else either
 * works or quietly does not.
 *
 * <h3>It computes nothing</h3>
 * The percentage and the requirement list both come from the server, and that is the point: the
 * same figure gates the transition to ACTIVE, so a locally derived percentage can read 100% while
 * the service still refuses to advance the application. Reproducing the rule here would give a
 * clinician two numbers and no way to tell which one the business believes.
 *
 * <h3>The list matters more than the number</h3>
 * "62%" tells someone they are stuck. "62% — licence and photo still needed" tells them what to do
 * about it, and it is the same list `OnboardingService` uses to refuse activation, so the screen
 * and the refusal cannot disagree about what is outstanding.
 *
 * <h3>Requirement keys are translated; the status is not</h3>
 * The eight keys are this app's own vocabulary and get four catalogue entries each. The application
 * `status` is a server enum and is left alone — the same rule that keeps document statuses
 * untranslated, so a clinician and the administrator reviewing them describe one state one way.
 *
 * <p>Not a stat tile: it is a progress bar, a sentence and a checklist rather than one number, and
 * folding it into `hpd-stat-tile` would widen that component to cover something it has no shape
 * for.
 */
@Component({
  selector: 'hpd-completion-meter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule],
  template: `
    @if (progress(); as value) {
      <section
        class="hpd-surface rounded-hpd-sm px-4 py-3"
        [attr.aria-label]="'me.completion.title' | translate"
        data-test="completion-meter"
      >
        <div class="flex items-baseline justify-between gap-4">
          <h2 class="text-hpd-muted text-sm font-bold uppercase tracking-wide">{{ 'me.completion.title' | translate }}</h2>
          <p class="text-2xl font-bold tabular-nums" data-test="completion-percent">{{ value.percent }}%</p>
        </div>

        <div
          class="bg-hpd-border mt-3 h-2.5 w-full overflow-hidden rounded-full"
          role="progressbar"
          [attr.aria-valuenow]="value.percent"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div
            class="h-full rounded-full transition-[width] duration-500"
            [class]="value.complete ? 'bg-hpd-success' : 'bg-hpd-gold'"
            [style.width.%]="value.percent"
          ></div>
        </div>

        <p class="text-hpd-muted mt-3 text-sm">
          {{ (value.complete ? 'me.completion.complete' : 'me.completion.incomplete') | translate }}
        </p>

        <ul class="mt-3 flex flex-col gap-2">
          @for (requirement of value.requirements; track requirement.key) {
            <li class="flex items-center gap-2 text-sm" [attr.data-test]="'requirement-' + requirement.key">
              <span
                class="grid h-5 w-5 flex-none place-items-center rounded-full text-[11px] font-bold"
                [class]="requirement.done ? 'bg-hpd-success-tint text-hpd-success' : 'bg-hpd-border text-hpd-muted'"
                aria-hidden="true"
                >{{ requirement.done ? '✓' : '·' }}</span
              >
              <span [class]="requirement.done ? 'text-hpd-muted line-through' : 'font-semibold'">{{
                'me.completion.requirements.' + requirement.key | translate
              }}</span>
            </li>
          }
        </ul>
      </section>
    }
  `,
})
export class CompletionMeterComponent {
  /** Null while it loads, and for an account with no application at all — render nothing, not 0%. */
  readonly progress = input<OnboardingProgressDto | null>(null);
}
