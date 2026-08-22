import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { NavController } from '@ionic/angular/standalone';
import { of } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { WriteQueue } from '../../core/offline/write-queue.service';
import { ShareService } from '../../core/native/share.service';
import { MePage } from './me.page';

describe('MePage', () => {
  let fixture: ComponentFixture<MePage>;
  let page: MePage;
  let httpMock: HttpTestingController;
  let share: { canShare: jest.Mock; shareText: jest.Mock };
  let auth: { logout: jest.Mock };
  let nav: { navigateRoot: jest.Mock };

  const PROFILE_URL = 'services/professionalservice/api/onboarding/profile';
  const PROGRESS_URL = 'services/professionalservice/api/onboarding/progress';
  const CHANGE_PASSWORD_URL = 'api/account/change-password';
  const PREFERENCES_URL = 'services/professionalservice/api/notifications/preferences';
  const ROSTER_URL = 'services/professionalservice/api/duty-roster';

  beforeEach(() => {
    share = { canShare: jest.fn().mockResolvedValue(true), shareText: jest.fn().mockResolvedValue(undefined) };
    // hasUnsentWrites gates sign-out now: a queue holding clinical notes must not be wiped silently.
    auth = { logout: jest.fn().mockReturnValue(of(undefined)), hasUnsentWrites: jest.fn().mockReturnValue(false) };
    nav = { navigateRoot: jest.fn().mockResolvedValue(true) };

    TestBed.configureTestingModule({
      imports: [MePage, TranslateModule.forRoot()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ShareService, useValue: share },
        { provide: AuthService, useValue: auth },
        {
          provide: WriteQueue,
          useValue: { needingAttention: () => [], drain: jest.fn(), discardAll: jest.fn(), retry: jest.fn(), discard: jest.fn() },
        },
        { provide: NavController, useValue: nav },
      ],
    });

    fixture = TestBed.createComponent(MePage);
    page = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  /** ngOnInit reads the notification preferences too (MOB10); most tests do not care what they are. */
  const flushPreferences = (body: unknown = { messages: true, compliance: true, showSenderName: false }): void => {
    httpMock.expectOne(request => request.method === 'GET' && request.url.endsWith(PREFERENCES_URL)).flush(body);
  };

  /** ngOnInit also reads the completion figure (Phase 9); most tests do not care what it is. */
  const flushProgress = (body: unknown = { percent: 50, complete: false, status: 'SUBMITTED', requirements: [] }): void => {
    httpMock.expectOne(request => request.url.endsWith(PROGRESS_URL)).flush(body);
  };

  const loadProfile = (body: unknown = { firstName: 'Ama', lastName: 'Mensah', email: 'ama@example.com', mobilePhone: '024' }): void => {
    fixture.detectChanges();
    flushPreferences();
    flushProgress();
    httpMock.expectOne(request => request.url.endsWith(PROFILE_URL)).flush(body);
  };

  it('fills the form from the clinician profile', () => {
    loadProfile();

    expect(page.firstName).toBe('Ama');
    expect(page.email).toBe('ama@example.com');
  });

  it('round-trips an edit through PUT and keeps fields it does not edit', () => {
    // The server document carries far more than this form shows — identity card, address,
    // notification preferences. A partial write would blank them, so the loaded document is spread
    // into the body. This is the MOB11 gate: "profile edit round-trips".
    loadProfile({ id: 'p1', accountId: 'doctor', cardNumber: 'GHA-123', firstName: 'Ama', lastName: 'Mensah' });

    page.firstName = 'Améline';
    page.save();

    const put = httpMock.expectOne(request => request.method === 'PUT' && request.url.endsWith(PROFILE_URL));
    expect(put.request.body.firstName).toBe('Améline');
    expect(put.request.body.cardNumber).toBe('GHA-123');
    put.flush({ ...put.request.body });

    expect(page.savedMessage()).toBe('me.saved');
    expect(page.saveFailed()).toBe(false);

    // The completion figure is computed from what was just written, so it is re-read rather than
    // left showing the number from before the save — otherwise a clinician fills in their address
    // and the meter still says the address is missing.
    flushProgress({ percent: 63, complete: false, status: 'SUBMITTED', requirements: [] });
    expect(page.progress()?.percent).toBe(63);
  });

  it('reports a failed save without losing what was typed', () => {
    loadProfile();
    page.firstName = 'Typed but unsaved';
    page.save();

    httpMock.expectOne(request => request.method === 'PUT').flush({}, { status: 500, statusText: 'Server Error' });

    expect(page.saveFailed()).toBe(true);
    expect(page.savedMessage()).toBe('me.saveFailed');
    expect(page.firstName).toBe('Typed but unsaved');
  });

  it('treats a missing profile as an empty form, not an error state to block on', () => {
    // Normal for an account that has registered but not completed onboarding.
    fixture.detectChanges();
    flushPreferences();
    flushProgress();
    httpMock.expectOne(request => request.url.endsWith(PROFILE_URL)).flush({}, { status: 404, statusText: 'Not Found' });

    expect(page.loadFailed()).toBe(true);
    expect(page.firstName).toBe('');
  });

  it('shares a roster summary through the OS sheet', async () => {
    loadProfile();

    page.shareRoster();
    httpMock
      .expectOne(request => request.url.endsWith(ROSTER_URL))
      .flush([{ date: '2999-01-01', duty: 'DOCTOR', professionalId: 'p1', shift: 'DAY', name: 'Ward 3' }]);
    await fixture.whenStable();

    expect(share.shareText).toHaveBeenCalled();
    expect(share.shareText.mock.calls[0][0].text).toContain('2999-01-01');
  });

  it('says so rather than opening an empty sheet when nothing is upcoming', async () => {
    loadProfile();

    page.shareRoster();
    httpMock.expectOne(request => request.url.endsWith(ROSTER_URL)).flush([]);
    await fixture.whenStable();

    expect(share.shareText).not.toHaveBeenCalled();
    expect(page.shareMessage()).toBe('me.noRoster');
  });

  it('does not attempt to share where the sheet is unavailable', async () => {
    // The browser, which is where the app runs in development and in the planned Playwright e2e.
    share.canShare.mockResolvedValue(false);
    loadProfile();

    page.shareRoster();
    httpMock
      .expectOne(request => request.url.endsWith(ROSTER_URL))
      .flush([{ date: '2999-01-01', duty: 'DOCTOR', professionalId: 'p1', shift: 'DAY', name: 'Ward 3' }]);
    await fixture.whenStable();

    expect(share.shareText).not.toHaveBeenCalled();
    expect(page.shareMessage()).toBe('me.shareUnavailable');
  });

  it('signs out through AuthService and returns to login', () => {
    // Delegated, not reimplemented: logout() revokes the refresh family server-side while the token
    // is still valid, then wipes locally. Doing the local wipe here would leave a live family on
    // the server for a phone that has been signed out.
    loadProfile();

    page.signOut();

    expect(auth.logout).toHaveBeenCalledWith('user');
    expect(nav.navigateRoot).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
  });

  describe('notification preferences (MOB10)', () => {
    it('shows what the server says, not what the switches defaulted to', () => {
      fixture.detectChanges();
      flushPreferences({ messages: false, compliance: true, showSenderName: true });
      flushProgress();
      httpMock.expectOne(request => request.url.endsWith(PROFILE_URL)).flush({});

      expect(page.pushMessages()).toBe(false);
      expect(page.pushSenderName()).toBe(true);
    });

    it('keeps the server defaults when the read fails, rather than showing everything off', () => {
      // All-off would tell a clinician they receive nothing while the server happily sends.
      fixture.detectChanges();
      httpMock
        .expectOne(request => request.method === 'GET' && request.url.endsWith(PREFERENCES_URL))
        .flush({}, { status: 503, statusText: 'Service Unavailable' });
      flushProgress();
      httpMock.expectOne(request => request.url.endsWith(PROFILE_URL)).flush({});

      expect(page.pushMessages()).toBe(true);
      expect(page.pushCompliance()).toBe(true);
      expect(page.pushSenderName()).toBe(false);
    });

    it('writes all three on any single change', () => {
      loadProfile();

      page.setSenderName(true);

      // The endpoint replaces all three; a partial body would be indistinguishable from "off".
      const request = httpMock.expectOne(r => r.method === 'PUT' && r.url.endsWith(PREFERENCES_URL));
      expect(request.request.body).toEqual({ messages: true, compliance: true, showSenderName: true });
      request.flush({ messages: true, compliance: true, showSenderName: true });
      expect(page.prefsFailed()).toBe(false);
    });

    it('reports a failed write instead of leaving a switch lying about the server state', () => {
      loadProfile();

      page.setMessages(false);
      httpMock
        .expectOne(r => r.method === 'PUT' && r.url.endsWith(PREFERENCES_URL))
        .flush({}, { status: 503, statusText: 'Service Unavailable' });

      expect(page.prefsFailed()).toBe(true);
    });
  });

  describe('the completion meter (Phase 9)', () => {
    it('renders the SERVER figure, and never derives one', () => {
      // The same number gates the transition to ACTIVE, so a locally derived percentage can read
      // 100% while the service still refuses to advance the application.
      fixture.detectChanges();
      flushPreferences();
      flushProgress({
        percent: 75,
        complete: false,
        status: 'SUBMITTED',
        requirements: [
          { key: 'profile', done: true },
          { key: 'address', done: false },
        ],
      });
      httpMock.expectOne(request => request.url.endsWith(PROFILE_URL)).flush({});
      fixture.detectChanges();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('75%');
      expect(page.progress()?.requirements).toHaveLength(2);
    });

    it('renders NOTHING when there is no application, rather than 0%', () => {
      // An invited clinician who never applied has no progress to report. "0%" would tell them
      // they have done nothing wrong-but-everything, which is not what the server said.
      fixture.detectChanges();
      flushPreferences();
      httpMock.expectOne(request => request.url.endsWith(PROGRESS_URL)).flush({}, { status: 404, statusText: 'Not Found' });
      httpMock.expectOne(request => request.url.endsWith(PROFILE_URL)).flush({});
      fixture.detectChanges();

      expect(page.progress()).toBeNull();
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-test="completion-meter"]')).toBeNull();
    });
  });

  describe('the fields the meter counts', () => {
    it('fills the nested address and next-of-kin from the loaded profile', () => {
      loadProfile({
        firstName: 'Ama',
        address: { streetAddress: '12 Ring Road', city: 'Accra', region: 'Greater Accra', country: 'GH', town: 'Osu' },
        emergencyContact: { name: 'Kofi', relationship: 'Brother', phone: '024' },
      });

      expect(page.street).toBe('12 Ring Road');
      expect(page.region).toBe('Greater Accra');
      expect(page.kinRelationship).toBe('Brother');
    });

    it('preserves nested fields the form does NOT offer', () => {
      // town, district and digital address are optional to the server and absent from this form. A
      // save that dropped them would quietly delete data the clinician entered on the web.
      loadProfile({ address: { streetAddress: '12 Ring Road', town: 'Osu', digitalAddress: 'GA-123-4567' } });

      page.city = 'Accra';
      page.save();

      const put = httpMock.expectOne(request => request.method === 'PUT' && request.url.endsWith(PROFILE_URL));
      expect(put.request.body.address).toEqual(
        expect.objectContaining({ town: 'Osu', digitalAddress: 'GA-123-4567', city: 'Accra', streetAddress: '12 Ring Road' }),
      );
      put.flush(put.request.body);
      flushProgress();
    });

    it('sends an untouched optional field as undefined, not as an empty string', () => {
      // hasText() on the server treats blank as absent, so either would do — but an empty string
      // stored on the document is a value somebody later has to explain.
      loadProfile({});

      page.save();

      const put = httpMock.expectOne(request => request.method === 'PUT');
      expect(put.request.body.birthDate).toBeUndefined();
      expect(put.request.body.cardNumber).toBeUndefined();
      put.flush({});
      flushProgress();
    });
  });

  describe('changing the password', () => {
    it('refuses a mismatched confirmation before touching the network', () => {
      // The server takes one new password and trusts the client to have asked twice — there is no
      // second field for it to compare against, so this check exists nowhere else.
      loadProfile();
      page.currentPassword = 'old';
      page.newPassword = 'new-one';
      page.confirmPassword = 'new-two';

      page.changePassword();

      httpMock.expectNone(request => request.url.endsWith(CHANGE_PASSWORD_URL));
      expect(page.passwordMessage()).toBe('me.passwordMismatch');
    });

    it('refuses a password below the gateway bound, so a JHipster problem document is never the message', () => {
      loadProfile();
      page.newPassword = 'ab';
      page.confirmPassword = 'ab';

      page.changePassword();

      httpMock.expectNone(request => request.url.endsWith(CHANGE_PASSWORD_URL));
      expect(page.passwordMessage()).toBe('me.passwordLength');
    });

    it('posts to the GATEWAY, not to professionalservice', () => {
      // The gateway owns users and authentication; api/ only validates tokens and has no account
      // resource at all. Building this URL with a microservice argument would 404.
      loadProfile();
      page.currentPassword = 'old-password';
      page.newPassword = 'new-password';
      page.confirmPassword = 'new-password';

      page.changePassword();

      const request = httpMock.expectOne(r => r.method === 'POST' && r.url.endsWith(CHANGE_PASSWORD_URL));
      expect(request.request.url).not.toContain('professionalservice');
      expect(request.request.body).toEqual({ currentPassword: 'old-password', newPassword: 'new-password' });
      request.flush(null);

      expect(page.passwordFailed()).toBe(false);
      expect(page.passwordMessage()).toBe('me.passwordChanged');
    });

    it('clears the three fields on success, so nothing is left on screen', () => {
      loadProfile();
      page.currentPassword = 'old-password';
      page.newPassword = 'new-password';
      page.confirmPassword = 'new-password';
      page.changePassword();

      httpMock.expectOne(r => r.method === 'POST' && r.url.endsWith(CHANGE_PASSWORD_URL)).flush(null);

      expect(page.currentPassword).toBe('');
      expect(page.newPassword).toBe('');
    });

    it('reads a 400 as the wrong CURRENT password, having already ruled out length', () => {
      loadProfile();
      page.currentPassword = 'wrong';
      page.newPassword = 'new-password';
      page.confirmPassword = 'new-password';
      page.changePassword();

      httpMock
        .expectOne(r => r.method === 'POST' && r.url.endsWith(CHANGE_PASSWORD_URL))
        .flush({}, { status: 400, statusText: 'Bad Request' });

      expect(page.passwordFailed()).toBe(true);
      expect(page.passwordMessage()).toBe('me.passwordWrong');
    });
  });

  afterEach(() => httpMock.verify());
});
