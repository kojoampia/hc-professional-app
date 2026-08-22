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

  const loadProfile = (body: unknown = { firstName: 'Ama', lastName: 'Mensah', email: 'ama@example.com', mobilePhone: '024' }): void => {
    fixture.detectChanges();
    flushPreferences();
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

  afterEach(() => httpMock.verify());
});
