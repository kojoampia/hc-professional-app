import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateLoader, TranslateModule, TranslateService } from '@ngx-translate/core';

import { BundledTranslateLoader, LanguageService } from '../../core/i18n/language.service';
import { PreferencesService } from '../../core/native/preferences.service';
import { ArchivedBannerComponent } from './archived-banner.component';

/**
 * That an archived case says it is archived, and that a live one says nothing at all.
 *
 * <h3>Why this is a component rather than markup on the page</h3>
 * The banner belongs at the top of the case detail, which lives inside an `ion-modal`. Ionic renders
 * modal content into an overlay that jsdom never instantiates — measured here, not assumed: rendering
 * `CasesPage` with a case open yields the queue's text and nothing of the modal. That is the same
 * constraint that made the password-reset screens their own component and that `reachable-members.spec.ts`
 * was written around. As its own component the banner can be rendered and read, in four languages,
 * which is what `../docs/backlog.md` item 104 actually asks to be true.
 *
 * <p>The page's half — that it *uses* this component, bound to the right field — is asserted by
 * `cases.page.spec.ts`, for the same reason and in the same way that spec's neighbours are.
 *
 * <h3>The inverse is the assertion that matters</h3>
 * A banner on every case is worse than no banner: it would say a live case is retired, on the screen
 * whose whole subject is a clinical decision. So "live shows nothing" is checked in both spellings the
 * service can produce — `null` from any build since item 82, and an absent key from one that predates it.
 */
describe('hpd-archived-banner', () => {
  const render = (archivedAt: string | null | undefined, language = 'en'): ComponentFixture<ArchivedBannerComponent> => {
    // Through LanguageService, because that is what moves BOTH the catalogue and the locale the
    // date pipe is given. Driving `translate.use` alone would leave the date in English and the
    // per-locale assertions below would be proving nothing about the date.
    TestBed.inject(LanguageService).use(language as 'en' | 'es' | 'fr' | 'de');
    const fixture = TestBed.createComponent(ArchivedBannerComponent);
    fixture.componentRef.setInput('archivedAt', archivedAt ?? null);
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot({ defaultLanguage: 'en', loader: { provide: TranslateLoader, useClass: BundledTranslateLoader } })],
      providers: [{ provide: PreferencesService, useValue: { get: async () => null, set: async () => undefined } }],
    });
    // Registers the es/fr/de locale data as a side effect of the import; without it `DatePipe`
    // throws `Missing locale data` rather than falling back, which would hide the locale question
    // behind an exception.
    TestBed.inject(LanguageService);
    // With no active language ngx-translate renders the key itself — the very failure this checks.
    TestBed.inject(TranslateService).use('en');
  });

  it('says the case is retired, and when', () => {
    const text = render('2026-08-21T14:05:00Z').nativeElement.textContent;

    expect(text).toContain('Archived');
    expect(text).toContain('Aug 21, 2026');
    expect(text).toContain('This case is retired.');
  });

  it('says NOTHING for a live case, which sends null', () => {
    // The inverse, and the one that matters. A banner on every case tells a clinician a current
    // diagnosis is retired — the opposite of the defect item 104 exists to fix, and worse.
    expect(render(null).nativeElement.textContent.trim()).toBe('');
  });

  it('says nothing when the field is absent, as a service predating item 82 sends it', () => {
    // A phone is not redeployed with the service. Until every environment carries `api/` #46 this
    // app talks to one that omits the key, and guessing from an absence would invent a fact.
    expect(render(undefined).nativeElement.textContent.trim()).toBe('');
  });

  it.each([
    ['en', 'Archived', 'Aug 21, 2026'],
    ['es', 'Archivado el', '21 ago 2026'],
    ['fr', 'Archivé le', '21 août 2026'],
    ['de', 'Archiviert am', '21.08.2026'],
  ])('renders real text in %s, not a key and not an English date', (language, label, date) => {
    // Two failures in one assertion because they are the two this app actually ships: ngx-translate
    // renders a missing key verbatim, and `DatePipe` formats through LOCALE_ID rather than through
    // ngx-translate, so a hardcoded locale leaves an English date beside translated copy.
    const text = render('2026-08-21T14:05:00Z', language).nativeElement.textContent;

    expect(text).toContain(label);
    expect(text).toContain(date);
    expect(text).not.toMatch(/\bcases\.[a-zA-Z]+/);
  });
});
