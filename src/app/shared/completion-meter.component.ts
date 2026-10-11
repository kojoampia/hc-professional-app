import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

import { ONBOARDING_STEP_KEYS, OnboardingProgressDto } from '../core/api/profile-api.service';

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
 * The nine keys are this app's own vocabulary and get four catalogue entries each. The application
 * `status` is a server enum and is left alone — the same rule that keeps document statuses
 * untranslated, so a clinician and the administrator reviewing them describe one state one way.
 *
 * <h3>⭐ Two readings of one state, both on screen (`backlog.md` row 230, unit C)</h3>
 * Row 230 decided the wire carries `profile.md`'s <b>four coarse steps</b> — one boolean each —
 * beside the requirement list. Both are rendered because they answer different questions: the steps
 * say <i>where am I in this process</i>, the requirements say <i>what exactly is missing</i>. The
 * coarse row alone would have regressed what this component can say, which is the objection the
 * section above records.
 *
 * <p>⚠ <b>Each step is resolved independently</b> — {@link ONBOARDING_STEP_KEYS} is walked and each
 * key read on its own — so a wiring mistake costs one tick rather than all four.
 * `completion-meter.component.spec.ts` flips one step at a time for exactly that reason: an
 * aggregate "renders the steps" assertion cannot tell which of the four is connected to which
 * boolean, and three of them hardcoded would satisfy it.
 *
 * <p>⛔ <b>An absent `steps` object renders NO step section at all</b> — not four unticked steps.
 * This app ships through a store, so a binary can outlive its server's version by months and really
 * can meet a gateway that predates row 230 unit A; see `OnboardingProgressDto.steps`.
 *
 * <p>⚠ <b>The first version of this rendered four incomplete steps, and the javadoc defended it as
 * "four incomplete steps rather than a blank screen". That was a false dichotomy and the probe found
 * it:</b> with `steps` absent and the clinician complete, the screen showed four unticked steps
 * directly above <i>"Everything is in. An administrator reviews your credentials next."</i> — a
 * self-contradicting screen, in precisely the old-gateway case the optional type exists for. The
 * third option is the right one: <b>omit the section.</b> Unknown is not the same as unticked, and a
 * section with nothing to say says nothing. {@link CompletionMeterComponent#steps} keeps its
 * `?? false` behind that guard as defence in depth rather than as the behaviour.
 *
 * <p>⚠ <b>Step 1 reads `false` for every clinician on quality today and that is correct</b> —
 * nothing here tries to correct it, per `backlog.md` rows 232–234. That is a step the server
 * reported as incomplete, which is a different thing from a step it did not report.
 *
 * <h3>⛔ There is no live push here, and that is the owner's decision rather than an omission</h3>
 * `web/` consumes row 230's SSE stream (unit B). <b>`mobile/` deliberately does not.</b> Mobile CI
 * clones one repository, so that stream service cannot be shared — porting it would be a second copy
 * of a five-state machine with two reconnect operators and a flag leak that took two review rounds to
 * find, and this estate's own note is that <i>two correct-for-now copies is how an estate arrives at
 * one wrong one</i>. The staleness that actually bites here is a different one: `me.page.ts` read the
 * figure in `ngOnInit` only and Ionic caches pages, so re-entering the tab showed a stale meter. One
 * lifecycle hook fixes the real defect, duplicates no state machine, and suits a lifecycle where a
 * held connection costs battery and is killed when the app backgrounds. See
 * {@link MePage#ionViewWillEnter}.
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

        <!-- profile.md's four coarse steps (row 230). Numbered rather than tiled: web/ grids these
             four across the page, which at 390px would wrap each label onto two lines.

             The @if is not defensive decoration — see the class docblock. A server that sends no
             steps gets NO section at all, because four unticked steps sitting above "Everything is
             in" is a self-contradicting screen. -->
        @if (value.steps) {
          <ol class="mt-4 flex flex-col gap-2" data-test="completion-steps">
            @for (step of steps(); track step.key) {
              <li
                class="rounded-hpd-sm flex items-center gap-3 border p-2.5"
                [class]="step.done ? 'border-hpd-success bg-hpd-success-tint' : 'border-hpd-border bg-hpd-cream'"
                [attr.data-test]="'step-' + step.key"
                [attr.data-done]="step.done"
              >
                <span
                  class="grid h-6 w-6 flex-none place-items-center rounded-full text-[11px] font-bold"
                  [class]="step.done ? 'bg-hpd-success text-hpd-cream' : 'bg-hpd-border text-hpd-muted'"
                  aria-hidden="true"
                  >{{ step.done ? '✓' : step.ordinal }}</span
                >
                <span class="text-sm font-semibold" [class]="step.done ? 'text-hpd-muted' : 'text-hpd-primary-dark'">{{
                  'me.completion.steps.' + step.key | translate
                }}</span>
                <!-- ⚠ The tick and the ordinal are aria-hidden and every other carrier of state here
                     is a colour class, so without this a screen reader hears four labels and NO
                     state. ⛔ The requirements list below has the identical gap and is deliberately
                     left alone — it is pre-existing and not row 230's; this is the house pattern it
                     was matched from, which is exactly how the gap propagated. -->
                <span class="sr-only">{{ (step.done ? 'me.completion.stepState.done' : 'me.completion.stepState.todo') | translate }}</span>
              </li>
            }
          </ol>
        }

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

  /**
   * The four steps as the template needs them, read from the server's `steps` object.
   *
   * <p>⚠ <b>Each key is read on its own</b> — see the class docblock. The order and the membership
   * come from {@link ONBOARDING_STEP_KEYS} rather than being written out here, so a step added to the
   * contract arrives with no edit to this file. ⚠ What then demands a <b>label</b> for it is
   * `completion-meter.component.spec.ts`'s no-raw-key case, <b>not</b> `catalogues.spec.ts` — that one
   * compares the four locales against each other, and a key absent from all four leaves them in
   * perfect agreement.
   *
   * <p>⚠ The `?? false` here is <b>defence in depth, not the behaviour</b>: the template's
   * `@if (value.steps)` means these rows are never rendered when the server sent no steps, because
   * four unticked steps is a claim and silence is not. See the class docblock.
   */
  readonly steps = computed(() => {
    const steps = this.progress()?.steps;
    return ONBOARDING_STEP_KEYS.map((key, index) => ({ key, ordinal: index + 1, done: steps?.[key] ?? false }));
  });
}
