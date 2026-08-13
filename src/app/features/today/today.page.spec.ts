import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { NavController } from '@ionic/angular/standalone';
import { TranslateLoader, TranslateModule, TranslateService } from '@ngx-translate/core';

import { AccountService } from '../../core/auth/account.service';
import { BundledTranslateLoader, LanguageService } from '../../core/i18n/language.service';
import { NetworkService } from '../../core/native/network.service';
import { TodayStore } from './today.store';
import { TodayPage } from './today.page';

/**
 * The shift headline is translated, and *stays* translated when the language changes.
 *
 * <p>These two headings are `computed()` signals rather than template expressions, because they
 * pick one of six phrasings from the roster state. That makes them the one place in this app where
 * the `translate` pipe cannot be used, and `TranslateService.instant` is not a substitute on its
 * own: the pipe is impure and re-runs on a language change, while `instant` is an ordinary function
 * call whose result is frozen into the computed until one of its *tracked* dependencies changes.
 *
 * <p>Getting that wrong is not a crash. The app translates, the Today card does not, and it only
 * corrects itself when the roster next changes — which on a quiet day is never. So the second test
 * here is the one that matters, and it fails if the `language.current()` read in `TodayPage.t()` is
 * removed as apparently dead code.
 */
describe('TodayPage — the shift headline follows the chosen language', () => {
  const shiftLabel = signal<{ kind: string; time?: string; date?: string } | null>(null);
  const account = signal<{ firstName?: string }>({ firstName: 'Kojo' });

  beforeEach(() => {
    shiftLabel.set(null);
    account.set({ firstName: 'Kojo' });

    TestBed.configureTestingModule({
      imports: [TodayPage, TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: BundledTranslateLoader } })],
      providers: [
        provideRouter([]),
        // Only the two signals the headline reads. The real store fetches four resources through
        // an encrypted cache, none of which this is about.
        {
          provide: TodayStore,
          useValue: {
            shiftLabel,
            upcoming: signal([]),
            expiringDocuments: signal([]),
            unread: { value: signal(0) },
            application: { value: signal(null) },
            roster: { status: signal('ready'), value: signal([]) },
            documents: { status: signal('ready'), value: signal([]) },
            featuredAssignment: signal(null),
            oldestFetchedAt: signal(null),
            refresh: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: AccountService, useValue: { account } },
        { provide: NetworkService, useValue: { connected: signal(true) } },
        { provide: NavController, useValue: { navigateForward: jest.fn() } },
      ],
    });

    TestBed.inject(TranslateService).setDefaultLang('en');
  });

  function page(): TodayPage {
    return TestBed.createComponent(TodayPage).componentInstance;
  }

  function use(language: string): void {
    TestBed.inject(LanguageService).use(language);
  }

  it.each([
    ['en', 'No shift assigned', 'Nothing today, Kojo'],
    ['es', 'Sin turno asignado', 'Hoy no hay nada, Kojo'],
    ['fr', 'Aucun service attribué', "Rien aujourd'hui, Kojo"],
    ['de', 'Kein Dienst zugewiesen', 'Heute nichts, Kojo'],
  ])('reads %s with no roster', (language, heading, title) => {
    use(language);
    const component = page();

    expect(component.shiftHeading()).toBe(heading);
    expect(component.shiftTitle()).toBe(title);
  });

  it('re-translates when the language changes while the card is on screen', () => {
    const component = page();
    expect(component.shiftHeading()).toBe('No shift assigned');

    use('de');

    // The roster has not changed — only the language. Without the language read in t(), this
    // still says "No shift assigned" and the bug is invisible until the next roster update.
    expect(component.shiftHeading()).toBe('Kein Dienst zugewiesen');
    expect(component.shiftTitle()).toBe('Heute nichts, Kojo');
  });

  it('interpolates the shift time rather than concatenating an English word', () => {
    shiftLabel.set({ kind: 'active', time: '14:00' });
    use('de');

    expect(page().shiftTitle()).toBe('Bis 14:00');
  });

  it('falls back to the unnamed greeting when the account has no first name', () => {
    account.set({});
    use('fr');

    expect(page().shiftTitle()).toBe("Rien aujourd'hui");
  });
});
