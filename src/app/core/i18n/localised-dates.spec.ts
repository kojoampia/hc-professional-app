import { DatePipe } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { TranslateLoader, TranslateModule, TranslateService } from '@ngx-translate/core';

import { BundledTranslateLoader, LanguageService } from './language.service';
import { RelativeTime } from './relative-time.service';

/**
 * Dates and cache ages render in the chosen language.
 *
 * <p>Reported from a device running the German build: the Messages list showed "Wed 13 Aug, 09:12"
 * beside fully translated copy. Two separate causes, neither of which any existing check could see.
 *
 * <p><strong>`DatePipe` does not use ngx-translate.</strong> It formats through Angular's own
 * `LOCALE_ID`, which defaults to `en-US` and is unaffected by `translate.use('de')`. Every
 * `| date:` in the app was therefore English in all four locales. Angular also ships only `en-US`
 * locale data by default, so asking for another without `registerLocaleData` throws `Missing locale
 * data` — which is why this spec asserts the registration works, not merely that a locale was
 * passed.
 *
 * <p><strong>`describeAge` returned English sentences.</strong> It lives in `core/offline/`, not a
 * component, so the template scanner never looked at it and the translate pipe could not reach it.
 * It rendered beside the "updated" label on three screens.
 */
describe('dates and ages are localised', () => {
  let pipe: DatePipe;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: BundledTranslateLoader } })],
    });
    TestBed.inject(TranslateService).setDefaultLang('en');
    pipe = new DatePipe('en-US');
  });

  const when = new Date(2026, 7, 13, 9, 12);

  it.each([
    ['en', 'Thu 13 Aug'],
    ['es', 'jue 13 ago'],
    ['fr', 'jeu. 13 août'],
    ['de', 'Do. 13 Aug.'],
  ])('formats a date in %s', (locale, expected) => {
    // Locale data must be registered for anything but en-US, or this throws rather than falling
    // back — the failure mode is loud here and silent-English in the app.
    expect(pipe.transform(when, 'EEE d MMM', undefined, locale)).toBe(expected);
  });

  it('sets the document language, which is what a screen reader announces', () => {
    // index.html is static `lang="en"`. Nothing else updates it, so a German app told TalkBack it
    // was English and got German words read with English phonetics — invisible to a visual check.
    TestBed.inject(LanguageService).use('de');

    expect(document.documentElement.lang).toBe('de');
  });

  it('exposes the active language as the locale the pipes are given', () => {
    const language = TestBed.inject(LanguageService);

    language.use('fr');

    expect(language.current()).toBe('fr');
    expect(pipe.transform(when, 'EEE d MMM', undefined, language.current())).toBe('jeu. 13 août');
  });

  describe('cache age', () => {
    const now = Date.UTC(2026, 7, 13, 12, 0, 0);

    it.each([
      ['en', '12 min ago'],
      ['es', 'hace 12 min'],
      ['fr', 'il y a 12 min'],
      ['de', 'vor 12 Min.'],
    ])('reads %s', (language, expected) => {
      TestBed.inject(LanguageService).use(language);

      expect(TestBed.inject(RelativeTime).describe(now - 12 * 60_000, now)).toBe(expected);
    });

    it('follows a language change without the age itself changing', () => {
      const relativeTime = TestBed.inject(RelativeTime);
      const language = TestBed.inject(LanguageService);

      language.use('en');
      expect(relativeTime.describe(now - 3 * 3_600_000, now)).toBe('3 h ago');

      language.use('de');
      expect(relativeTime.describe(now - 3 * 3_600_000, now)).toBe('vor 3 Std.');
    });

    it('translates the never case, which has no count to interpolate', () => {
      TestBed.inject(LanguageService).use('de');

      expect(TestBed.inject(RelativeTime).describe(null, now)).toBe('nie');
    });
  });
});
