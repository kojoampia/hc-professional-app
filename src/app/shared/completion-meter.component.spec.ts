import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateLoader, TranslateModule, TranslateService } from '@ngx-translate/core';

import { BundledTranslateLoader } from '../core/i18n/language.service';
import { CATALOGUES, SUPPORTED_LANGUAGES } from '../core/i18n/catalogues';
import { ONBOARDING_REQUIREMENT_KEYS, ONBOARDING_STEP_KEYS, OnboardingProgressDto, OnboardingSteps } from '../core/api/profile-api.service';
import { CompletionMeterComponent } from './completion-meter.component';

/**
 * The meter's two rows — `profile.md`'s four coarse steps and the nine requirements — as rendered.
 * `backlog.md` row 230, unit C.
 *
 * <h3>⚠ Rendered against the REAL catalogues, and that is the point</h3>
 *
 * <p>This component renders every key the server sends, assembled at run time
 * (`'me.completion.steps.' + step.key`). ngx-translate answers a missing key with <b>the key
 * itself</b> — nothing throws, nothing logs — so a label this app has no catalogue entry for is a
 * user-visible string reading `me.completion.steps.account` in the middle of the screen, and
 * `template-keys.spec.ts` structurally cannot see it because the key is not a literal in the source.
 * A `TranslateModule.forRoot()` with no loader would render those same keys and pass. So the real
 * catalogues are loaded here, and {@link SUPPORTED_LANGUAGES} is walked rather than English alone.
 *
 * <h3>⛔ "No raw key on screen" does NOT cover a label missing from one locale — measured</h3>
 *
 * <p>The obvious reading of the assertion below is that it catches a forgotten translation in any of
 * the four. <b>It does not</b>, and the two mutations that establish it are worth writing down
 * because the conclusion is the opposite of the intuition:
 *
 * <ul>
 *   <li>Delete the <b>French</b> step label → this suite's `fr shows no raw translation key` stays
 *       <b>green</b>. ngx-translate's `useDefaultLang` is on, so a key missing from `fr` falls back
 *       to `en` and the French screen renders <i>Credential documents</i> — English text, no raw key,
 *       nothing thrown. What goes red is `catalogues.spec.ts`'s key parity and the per-locale wording
 *       case below, which compares against that locale's <i>own</i> value.
 *   <li>Delete the <b>English</b> one → `en shows no raw translation key` goes red with
 *       `me.completion.steps.documents` in the rendered text, and the other three stay green,
 *       because each has its own value and never consults the default.
 * </ul>
 *
 * <p>⭐ <b>So a raw key on screen means the label is missing from the current locale AND from
 * English.</b> The two checks answer different questions and both are needed: this one catches a
 * label nobody added anywhere, the wording one catches a locale left behind.
 *
 * <h3>⚠ One step is flipped at a time, deliberately</h3>
 *
 * <p>An aggregate "renders the four steps" assertion is satisfied by a template that reads one
 * boolean and renders it four times. Four cases each flipping a single step are what distinguish a
 * wired step from a coincidence.
 */
describe('hpd-completion-meter', () => {
  let fixture: ComponentFixture<CompletionMeterComponent>;

  const steps = (overrides: Partial<OnboardingSteps> = {}): OnboardingSteps => ({
    account: false,
    profile: false,
    documents: false,
    consent: false,
    ...overrides,
  });

  const meter = (overrides: Partial<OnboardingProgressDto> = {}): OnboardingProgressDto => ({
    percent: 50,
    complete: false,
    status: 'SUBMITTED',
    requirements: [],
    steps: steps(),
    ...overrides,
  });

  const render = (progress: OnboardingProgressDto | null, language = 'en'): ComponentFixture<CompletionMeterComponent> => {
    TestBed.inject(TranslateService).use(language);
    fixture = TestBed.createComponent(CompletionMeterComponent);
    fixture.componentRef.setInput('progress', progress);
    fixture.detectChanges();
    return fixture;
  };

  const text = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';

  /** The rendered steps as `{ key: done }` — what makes a one-step assertion readable. */
  const renderedSteps = (): Record<string, boolean> =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('[data-test^="step-"]')].reduce<Record<string, boolean>>(
      (acc, element) => ({
        ...acc,
        [element.getAttribute('data-test')!.slice('step-'.length)]: element.getAttribute('data-done') === 'true',
      }),
      {},
    );

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot({ defaultLanguage: 'en', loader: { provide: TranslateLoader, useClass: BundledTranslateLoader } })],
    });
  });

  it('renders nothing at all when there is no progress to report', () => {
    // An invited clinician who never applied. "0%" would report something the server did not say.
    render(null);

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-test="completion-meter"]')).toBeNull();
  });

  describe("profile.md's four coarse steps", () => {
    it('renders all four, in the order the contract names them', () => {
      render(meter());

      expect(Object.keys(renderedSteps())).toEqual([...ONBOARDING_STEP_KEYS]);
    });

    // Four cases, one flipped boolean each. See the docblock: an aggregate assertion cannot tell
    // which step is wired, and a @for rendering steps.account four times would satisfy one.
    it('ticks step 1 — account — and only step 1', () => {
      render(meter({ steps: steps({ account: true }) }));

      expect(renderedSteps()).toEqual({ account: true, profile: false, documents: false, consent: false });
    });

    it('ticks step 2 — profile — and only step 2', () => {
      render(meter({ steps: steps({ profile: true }) }));

      expect(renderedSteps()).toEqual({ account: false, profile: true, documents: false, consent: false });
    });

    it('ticks step 3 — documents — and only step 3', () => {
      render(meter({ steps: steps({ documents: true }) }));

      expect(renderedSteps()).toEqual({ account: false, profile: false, documents: true, consent: false });
    });

    it('ticks step 4 — consent — and only step 4', () => {
      render(meter({ steps: steps({ consent: true }) }));

      expect(renderedSteps()).toEqual({ account: false, profile: false, documents: false, consent: true });
    });

    /**
     * ⚠ `steps.account` reads `false` for every seeded clinician on quality and that is CORRECT —
     * three independent reasons, all in `backlog.md` rows 232, 233 and 234. This case is the exact
     * shape measured as `nurse` after unit B's roll, pinned so that nobody "fixes" it.
     */
    it('leaves step 1 unticked without complaint — the quality shape, which is correct', () => {
      render(meter({ percent: 89, steps: steps({ documents: true, consent: true }) }));

      expect(renderedSteps()).toEqual({ account: false, profile: false, documents: true, consent: true });
      expect(text()).toContain('89%');
    });

    /**
     * ⛔ An absent `steps` object renders NO section — not four unticked steps.
     *
     * <p>This app ships through a store, so a binary can reach a gateway older than row 230 unit A.
     * The first version rendered four unticked steps and the javadoc defended it as "rather than a
     * blank screen"; what refuted that is the case below with the clinician <b>complete</b> — four
     * unticked steps then sit directly above "Everything is in", a screen contradicting itself in
     * precisely the scenario the optional type exists for. Unknown is not unticked. See
     * `OnboardingProgressDto.steps`.
     */
    it('omits the step section entirely when the server sent no steps', () => {
      render(meter({ steps: undefined, percent: 100, complete: true }));

      const element = fixture.nativeElement as HTMLElement;
      expect(element.querySelector('[data-test="completion-steps"]')).toBeNull();
      expect(element.querySelectorAll('[data-test^="step-"]')).toHaveLength(0);
      // ⚠ And nothing goes with it: the number, the sentence and the requirement list are exactly
      // what an older server can still say, so this degrades rather than blanking.
      expect(element.querySelector('[data-test="completion-meter"]')).not.toBeNull();
      expect(text()).toContain('100%');
      expect(text()).toContain(CATALOGUES.en.me.completion.complete);
    });

    it('still renders the requirement list in full when the step section is omitted', () => {
      render(meter({ steps: undefined, requirements: ONBOARDING_REQUIREMENT_KEYS.map(key => ({ key, done: false })) }));

      expect((fixture.nativeElement as HTMLElement).querySelectorAll('[data-test^="requirement-"]')).toHaveLength(9);
    });

    it('numbers the unticked steps from one, so a row says where it sits in the sequence', () => {
      render(meter());

      expect(text()).toContain('1');
      expect(fixture.componentInstance.steps().map(step => step.ordinal)).toEqual([1, 2, 3, 4]);
    });

    /**
     * ⛔ State a screen reader can hear.
     *
     * <p>A row's done-ness is carried by colour classes and by a glyph that is `aria-hidden`, so
     * without the visually-hidden string a non-sighted clinician hears four labels and no state —
     * which on this component is the <i>whole</i> content, since its job is saying what is
     * outstanding. Asserted per row rather than over the whole block, because one shared string
     * would be the same defect in a different place.
     */
    it('says each step state in words, not only in colour', () => {
      render(meter({ steps: steps({ documents: true }) }));

      const state = (key: string): string | null =>
        (fixture.nativeElement as HTMLElement).querySelector(`[data-test="step-${key}"] .sr-only`)?.textContent?.trim() ?? null;

      expect(state('documents')).toBe(CATALOGUES.en.me.completion.stepState.done);
      expect(state('account')).toBe(CATALOGUES.en.me.completion.stepState.todo);
      expect(state('profile')).toBe(CATALOGUES.en.me.completion.stepState.todo);
      expect(state('consent')).toBe(CATALOGUES.en.me.completion.stepState.todo);
    });
  });

  describe('every label resolves, in every locale', () => {
    /**
     * ⭐ The assertion that matters most here. This meter renders unknown keys blindly, so a label
     * missing from one catalogue is a sentence of dotted identifier on screen — perfect in the
     * English build, broken on three locales, and nothing thrown either way.
     */
    it.each([...SUPPORTED_LANGUAGES])('%s shows no raw translation key anywhere in the meter', language => {
      render(
        meter({
          steps: steps({ documents: true, consent: true }),
          requirements: ONBOARDING_REQUIREMENT_KEYS.map(key => ({ key, done: key !== 'nextOfKin' })),
        }),
        language,
      );

      expect(text()).not.toContain('me.completion.');
    });

    /**
     * The locale-left-behind half, and the one the assertion above cannot make — see the docblock.
     * It compares against each catalogue's <b>own</b> value, so a French screen silently serving the
     * English string through `useDefaultLang` is red here and green there.
     */
    it.each([...SUPPORTED_LANGUAGES])('%s names all four steps with its own wording', language => {
      render(meter(), language);

      const labels = CATALOGUES[language].me.completion.steps;
      for (const key of ONBOARDING_STEP_KEYS) {
        expect(text()).toContain(labels[key]);
      }
    });

    /**
     * The screen-reader state strings, in each locale's own words and for both states at once.
     *
     * <p>⚠ These keys are new, so they are also the ones most likely to be added to English and
     * forgotten elsewhere — and the no-raw-key case above cannot see that, for the `useDefaultLang`
     * reason in the docblock.
     */
    it.each([...SUPPORTED_LANGUAGES])('%s says both step states in its own wording', language => {
      render(meter({ steps: steps({ documents: true }) }), language);

      const states = CATALOGUES[language].me.completion.stepState;
      expect(text()).toContain(states.done);
      expect(text()).toContain(states.todo);
    });

    /**
     * The ninth requirement key, which proves the widened type and the catalogues agree.
     *
     * <p>`authority` has been on the wire since row 230 unit A and was labelled in all four
     * catalogues by it; what was short until unit C was `OnboardingRequirementKey`, a bare union of
     * eight. Nothing failed, because a type cannot — which is why this case asserts the rendered
     * label rather than the type.
     */
    it('renders the ninth requirement key with its label, not as a key', () => {
      render(meter({ requirements: [{ key: 'authority', done: true }] }));

      expect(text()).toContain(CATALOGUES.en.me.completion.requirements.authority);
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-test="requirement-authority"]')).not.toBeNull();
    });

    it('labels every requirement key the contract can send', () => {
      // Derived from the runtime array rather than a list written here — which is the whole reason
      // unit C made the union derivable. A key added to the contract fails this without an edit.
      render(meter({ requirements: ONBOARDING_REQUIREMENT_KEYS.map(key => ({ key, done: false })) }));

      expect(ONBOARDING_REQUIREMENT_KEYS).toHaveLength(9);
      for (const key of ONBOARDING_REQUIREMENT_KEYS) {
        expect(text()).toContain(CATALOGUES.en.me.completion.requirements[key]);
      }
    });
  });
});
