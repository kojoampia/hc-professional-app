import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { NavController } from '@ionic/angular/standalone';
import { TranslateLoader, TranslateModule, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../core/auth/auth.service';
import { AccountService } from '../core/auth/account.service';
import { AccountApiService } from '../core/api/account-api.service';
import { BundledTranslateLoader } from '../core/i18n/language.service';
import { LoginPage } from './login.page';

/**
 * The sign-in screen renders in the selected language.
 *
 * <p>`catalogues.spec.ts` proves the four catalogues agree, and `untranslated-literals.spec.ts`
 * proves no template hardcodes English. Neither proves the third thing: that a screen actually
 * reaches the catalogue. A page can pass both while binding a key that does not exist, because
 * ngx-translate renders a missing key as the key itself rather than throwing — `auth.signIn` would
 * appear on the button, and nothing would fail.
 *
 * <p>So this loads the real bundled catalogues, selects each language, and reads the rendered text.
 * It is the only check here that would catch a typo in a key name.
 */
describe('LoginPage — renders in the selected language', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LoginPage, TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: BundledTranslateLoader } })],
      providers: [
        provideRouter([]),
        // Stubbed rather than real: this asserts what the page displays, and the real services
        // reach secure storage, a socket and the network on construction.
        { provide: AuthService, useValue: { signOutReason: signal(null), login: jest.fn() } },
        { provide: AccountService, useValue: { identity: jest.fn() } },
        { provide: NavController, useValue: { navigateRoot: jest.fn() } },
        // The reset modal's service. Stubbed for the same reason as the other two — this file
        // asserts what the four locales render, not what the network does.
        {
          provide: AccountApiService,
          useValue: { requestPasswordReset: jest.fn(), finishPasswordReset: jest.fn(), changePassword: jest.fn() },
        },
      ],
    });
    TestBed.inject(TranslateService).setDefaultLang('en');
  });

  /** Renders the page in `language` and returns its visible text. */
  function textIn(language: string): string {
    TestBed.inject(TranslateService).use(language);
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it.each([
    ['en', 'Sign in'],
    ['es', 'Iniciar sesión'],
    ['fr', 'Se connecter'],
    ['de', 'Anmelden'],
  ])('signs in in %s', (language, expected) => {
    expect(textIn(language)).toContain(expected);
  });

  it('translates the field labels, not only the button', () => {
    const german = textIn('de');

    expect(german).toContain('Benutzername');
    expect(german).toContain('Passwort');
  });

  it.each(['en', 'es', 'fr', 'de'])('renders no bare translation keys in %s', language => {
    // A missing key renders as the key itself, which is how a typo in a key name reaches a screen.
    expect(textIn(language)).not.toMatch(/\b(auth|boot|common)\.[a-zA-Z]+/);
  });

  it.each(['en', 'es', 'fr', 'de'])('keeps the brand untranslated in %s', language => {
    expect(textIn(language)).toContain('Abofonsa BridgeCare');
  });
});
