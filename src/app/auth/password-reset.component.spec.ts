import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { AccountApiService } from '../core/api/account-api.service';
import { CATALOGUES } from '../core/i18n/catalogues';
import { PasswordResetComponent } from './password-reset.component';

/**
 * The reset screens, rendered.
 *
 * <p>A standalone spec rather than more cases in `login.page.spec.ts`, and the reason is the point
 * of the component existing: this UI lives inside an `ion-modal`, Ionic renders modal content into
 * an overlay, and in jsdom the `ng-template` is never instantiated at all. A four-locale check
 * written against the login page walks straight past every string here and passes — which is worse
 * than having no check, because it reads as coverage.
 *
 * <p>These are auth surfaces reached by someone who cannot get in. A wrong language here is the
 * worst possible moment for one.
 */
describe('PasswordResetComponent', () => {
  let api: { requestPasswordReset: jest.Mock; finishPasswordReset: jest.Mock };

  beforeEach(() => {
    api = { requestPasswordReset: jest.fn(() => of(undefined)), finishPasswordReset: jest.fn(() => of(undefined)) };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PasswordResetComponent, TranslateModule.forRoot()],
      providers: [{ provide: AccountApiService, useValue: api }],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setDefaultLang('en');
    // The real catalogues, not fixtures. A fixture copied from the code under test proves only that
    // the two agree; this asserts the strings that actually ship.
    Object.entries(CATALOGUES).forEach(([language, catalogue]) => translate.setTranslation(language, catalogue));
  });

  function textIn(language: string): string {
    TestBed.inject(TranslateService).use(language);
    const fixture = TestBed.createComponent(PasswordResetComponent);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it.each([
    ['en', 'Reset your password'],
    ['es', 'Restablecer su contraseña'],
    ['fr', 'Réinitialiser votre mot de passe'],
    ['de', 'Passwort zurücksetzen'],
  ])('shows the heading in %s', (language, expected) => {
    expect(textIn(language)).toContain(expected);
  });

  it.each(['en', 'es', 'fr', 'de'])('renders no bare translation keys in %s', language => {
    // ngx-translate renders a missing key as the key itself: nothing throws, nothing logs, and
    // `auth.resetKey` simply appears mid-screen.
    expect(textIn(language)).not.toMatch(/\b(auth|common)\.[a-zA-Z]+/);
  });

  it('tells the clinician the email opens a BROWSER, so the key must be pasted', () => {
    // This app registers no deep link — only the LAUNCHER intent filter, and no associatedDomains
    // entitlement — so a tapped link cannot return here. Without this sentence someone taps it and
    // waits for something that will never happen.
    expect(textIn('en')).toContain('browser');
  });

  function componentWith(setup: (component: PasswordResetComponent) => void): PasswordResetComponent {
    const fixture = TestBed.createComponent(PasswordResetComponent);
    fixture.detectChanges();
    setup(fixture.componentInstance);
    return fixture.componentInstance;
  }

  it('does NOT claim an email was sent, because the server never says', () => {
    const component = componentWith(c => (c.email = 'someone@example.com'));

    component.request();

    // /reset-password/init answers 200 whether or not the address exists, so nobody can use it to
    // discover which clinicians have accounts. "Sent" would be a claim this client cannot back.
    expect(component.message()).toBe('auth.resetRequested');
    expect(CATALOGUES.en.auth.resetRequested).toContain('If that address is registered');
    expect(CATALOGUES.en.auth.resetRequested).not.toContain('sent');
  });

  it('refuses an empty address without a request', () => {
    const component = componentWith(c => (c.email = '   '));

    component.request();

    expect(api.requestPasswordReset).not.toHaveBeenCalled();
    expect(component.message()).toBe('auth.resetNeedsEmail');
  });

  it('trims the address, so a pasted one with a trailing space still works', () => {
    const component = componentWith(c => (c.email = ' someone@example.com '));

    component.request();

    expect(api.requestPasswordReset).toHaveBeenCalledWith('someone@example.com');
  });

  it('checks the password length BEFORE sending, so a 400 is never the message', () => {
    // finishPasswordReset answers 400 for a bad length and 500 for an unknown key, and neither
    // carries anything a client can branch on. Ruling length out first is what makes the remaining
    // failure attributable.
    const component = componentWith(c => {
      c.key = 'a-key';
      c.password = 'ab';
    });

    component.finish();

    expect(api.finishPasswordReset).not.toHaveBeenCalled();
    expect(component.message()).toBe('auth.passwordLength');
  });

  it('refuses an empty key without sending', () => {
    const component = componentWith(c => {
      c.key = '  ';
      c.password = 'long-enough';
    });

    component.finish();

    expect(api.finishPasswordReset).not.toHaveBeenCalled();
    expect(component.message()).toBe('auth.resetNeedsKey');
  });

  it('reports an unrecognised key rather than passing a server error through', () => {
    api.finishPasswordReset.mockReturnValue(throwError(() => new Error('500')));
    const component = componentWith(c => {
      c.key = 'stale-key';
      c.password = 'long-enough';
    });

    component.finish();

    expect(component.message()).toBe('auth.resetBadKey');
    expect(component.failed()).toBe(true);
  });

  it('clears the key and password on success, so a second attempt starts clean', () => {
    const component = componentWith(c => {
      c.key = 'good-key';
      c.password = 'long-enough';
    });

    component.finish();

    expect(component.message()).toBe('auth.resetDone');
    expect(component.key).toBe('');
    expect(component.password).toBe('');
  });

  it('forgets the previous outcome when reopened', () => {
    // Otherwise a clinician who succeeded, closed and came back is greeted by a success message
    // about a reset they already finished.
    const component = componentWith(c => {
      c.key = 'good-key';
      c.password = 'long-enough';
    });
    component.finish();

    component.reset('someone@example.com');

    expect(component.message()).toBeNull();
    expect(component.email).toBe('someone@example.com');
  });
});
