import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom, lastValueFrom } from 'rxjs';

import { ApplicationConfigService } from '../config/application-config.service';
import { PushService } from '../native/push.service';
import { SecureTokenStore } from '../native/secure-token-store.service';
import { AuthService, SessionExpiredError } from './auth.service';
import { DeviceService } from './device.service';

const BASE = 'https://example.test/';

/**
 * Lets the promises inside AuthService settle before asserting on HTTP.
 *
 * Both `login()` and `refresh()` start from a promise — device identity and the
 * keystore read respectively — so the request is issued on a microtask, not
 * synchronously. Without this, `expectOne` runs before the request exists.
 */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

describe('AuthService', () => {
  let auth: AuthService;
  let http: HttpTestingController;
  let tokens: SecureTokenStore;
  let push: { unregister: jest.Mock };

  const tokenPair = (suffix: string) => ({
    id_token: 'access-' + suffix,
    refresh_token: 'refresh-' + suffix,
    expires_in: 900,
  });

  /** Signs in and leaves the service holding access-1 / refresh-1. */
  const signIn = async (): Promise<void> => {
    const done = firstValueFrom(auth.login('nurse', 'secret'));
    await settle();
    http.expectOne(BASE + 'api/authenticate').flush(tokenPair('1'));
    await done;
  };

  beforeEach(() => {
    push = { unregister: jest.fn(async () => undefined) };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PushService, useValue: push },
        {
          provide: DeviceService,
          useValue: {
            identity: async () => ({ client: 'mobile-ios', deviceId: 'device-1', deviceName: 'Test iPhone' }),
          },
        },
      ],
    });

    TestBed.inject(ApplicationConfigService).setEndpointPrefix(BASE);
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    tokens = TestBed.inject(SecureTokenStore);
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => http.verify());

  describe('login', () => {
    it('identifies itself as a mobile client — without which no refresh token is issued', async () => {
      const done = firstValueFrom(auth.login('nurse', 'secret'));
      await settle();

      const req = http.expectOne(BASE + 'api/authenticate');
      expect(req.request.body).toEqual({
        username: 'nurse',
        password: 'secret',
        client: 'mobile-ios',
        deviceId: 'device-1',
        deviceName: 'Test iPhone',
      });
      req.flush(tokenPair('1'));
      await done;
    });

    it('keeps the access token in memory and never in web storage', async () => {
      await signIn();

      expect(tokens.accessToken()).toBe('access-1');
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
    });

    it('reports whether the refresh token reached durable storage', async () => {
      // On web the store is memory-only by design, so this is false — which is what
      // the login screen uses to warn about an unprotected device.
      const done = firstValueFrom(auth.login('nurse', 'secret'));
      await settle();
      http.expectOne(BASE + 'api/authenticate').flush(tokenPair('1'));

      await expect(done).resolves.toBe(false);
    });

    it('records the expiry so staleness can be pre-empted', async () => {
      await signIn();

      expect(tokens.expiresAt()).toBeGreaterThan(Date.now());
      expect(tokens.isAccessTokenStale()).toBe(false);
    });

    it('clears any previous sign-out reason', async () => {
      await auth.discardStoredSession('session-expired');
      expect(auth.signOutReason()).toBe('session-expired');

      await signIn();
      expect(auth.signOutReason()).toBeNull();
    });
  });

  describe('refresh', () => {
    beforeEach(signIn);

    it('exchanges the stored token and adopts the new pair', async () => {
      const done = firstValueFrom(auth.refresh());
      await settle();

      const req = http.expectOne(BASE + 'api/auth/refresh');
      expect(req.request.body).toEqual({ refresh_token: 'refresh-1' });
      req.flush(tokenPair('2'));

      await expect(done).resolves.toBe('access-2');
      expect(tokens.accessToken()).toBe('access-2');
    });

    it('COALESCES concurrent callers into ONE request', async () => {
      // The critical one. N parallel refreshes would rotate once and then present an
      // already-spent token, which the gateway reads as reuse and answers by revoking
      // the whole family — client concurrency would look exactly like a stolen token.
      const all = Promise.all([firstValueFrom(auth.refresh()), firstValueFrom(auth.refresh()), firstValueFrom(auth.refresh())]);
      await settle();

      http.expectOne(BASE + 'api/auth/refresh').flush(tokenPair('2'));

      await expect(all).resolves.toEqual(['access-2', 'access-2', 'access-2']);
    });

    it('starts a fresh request once the previous one has settled', async () => {
      const first = firstValueFrom(auth.refresh());
      await settle();
      http.expectOne(BASE + 'api/auth/refresh').flush(tokenPair('2'));
      await first;

      const second = firstValueFrom(auth.refresh());
      await settle();
      http.expectOne(BASE + 'api/auth/refresh').flush(tokenPair('3'));

      await expect(second).resolves.toBe('access-3');
    });

    it('treats 401 as the end of the session and clears credentials', async () => {
      const done = firstValueFrom(auth.refresh());
      await settle();
      http.expectOne(BASE + 'api/auth/refresh').flush({}, { status: 401, statusText: 'Unauthorized' });

      await expect(done).rejects.toBeInstanceOf(SessionExpiredError);
      expect(auth.isAuthenticated()).toBe(false);
      await expect(tokens.hasRefreshToken()).resolves.toBe(false);
      expect(auth.signOutReason()).toBe('session-expired');
    });

    it('does NOT sign the user out when the network fails mid-refresh', async () => {
      // The gate item. A dropped connection must not discard a perfectly good
      // session — otherwise walking into a lift signs a clinician out.
      const done = firstValueFrom(auth.refresh());
      await settle();
      http.expectOne(BASE + 'api/auth/refresh').error(new ProgressEvent('network error'));

      await expect(done).rejects.toBeInstanceOf(HttpErrorResponse);
      await expect(tokens.hasRefreshToken()).resolves.toBe(true);
      expect(auth.isAuthenticated()).toBe(true);
      expect(auth.signOutReason()).toBeNull();
    });

    it('does not sign the user out on a server error either', async () => {
      const done = firstValueFrom(auth.refresh());
      await settle();
      http.expectOne(BASE + 'api/auth/refresh').flush('boom', { status: 503, statusText: 'Service Unavailable' });

      await expect(done).rejects.toBeDefined();
      await expect(tokens.hasRefreshToken()).resolves.toBe(true);
      expect(auth.signOutReason()).toBeNull();
    });

    it('fails without contacting the server when there is no stored token', async () => {
      await tokens.clear();

      const done = firstValueFrom(auth.refresh());
      await settle();
      http.expectNone(BASE + 'api/auth/refresh');

      await expect(done).rejects.toBeInstanceOf(SessionExpiredError);
    });
  });

  describe('logout', () => {
    beforeEach(signIn);

    it('revokes server-side FIRST, while the token is still valid', async () => {
      const done = lastValueFrom(auth.logout());
      await settle();

      const req = http.expectOne(BASE + 'api/auth/logout');
      // Clearing before revoking would strand a live family on the server that
      // nothing could ever revoke.
      expect(req.request.body).toEqual({ refresh_token: 'refresh-1' });
      req.flush(null, { status: 204, statusText: 'No Content' });
      await done;

      await expect(tokens.hasRefreshToken()).resolves.toBe(false);
      expect(auth.isAuthenticated()).toBe(false);
    });

    it('deregisters push before wiping credentials', async () => {
      const done = lastValueFrom(auth.logout());
      await settle();
      http.expectOne(BASE + 'api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
      await done;

      expect(push.unregister).toHaveBeenCalled();
    });

    it('still signs out locally when the revoke call fails', async () => {
      // Offline sign-out must work. The server-side family outlives it, but the
      // device must not stay signed in because the network was down.
      const done = lastValueFrom(auth.logout());
      await settle();
      http.expectOne(BASE + 'api/auth/logout').error(new ProgressEvent('offline'));
      await done;

      await expect(tokens.hasRefreshToken()).resolves.toBe(false);
      expect(auth.isAuthenticated()).toBe(false);
    });

    it('records why the session ended so the login screen can explain it', async () => {
      const done = lastValueFrom(auth.logout('biometry-changed'));
      await settle();
      http.expectOne(BASE + 'api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
      await done;

      expect(auth.signOutReason()).toBe('biometry-changed');
    });
  });
});
