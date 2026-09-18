import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Observable, of, throwError } from 'rxjs';

import { AuthService, SessionExpiredError } from '../auth/auth.service';
import { ApplicationConfigService } from '../config/application-config.service';
import { SecureTokenStore } from '../native/secure-token-store.service';
import { authInterceptor } from './auth.interceptor';
import { authRefreshInterceptor } from './auth-refresh.interceptor';

const BASE = 'https://example.test/';

describe('auth interceptors', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let tokens: SecureTokenStore;
  let auth: {
    isAuthenticated: jest.Mock;
    refresh: jest.Mock<Observable<string>, []>;
  };

  beforeEach(() => {
    auth = {
      isAuthenticated: jest.fn(() => true),
      // Mirrors the real service: a successful refresh writes the new token to the
      // store, which is what the replayed request then picks up.
      refresh: jest.fn(() => {
        TestBed.inject(SecureTokenStore).setAccessToken('fresh-token', 900);
        return of('fresh-token');
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authRefreshInterceptor, authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
      ],
    });

    TestBed.inject(ApplicationConfigService).setEndpointPrefix(BASE);
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    tokens = TestBed.inject(SecureTokenStore);
    tokens.setAccessToken('stale-token', 900);
  });

  afterEach(() => backend.verify());

  describe('authInterceptor', () => {
    it('attaches the bearer token to API requests', () => {
      http.get(BASE + 'api/account').subscribe();
      const req = backend.expectOne(BASE + 'api/account');
      expect(req.request.headers.get('Authorization')).toBe('Bearer stale-token');
      req.flush({});
    });

    it('NEVER attaches the token to another host', () => {
      // The token must not leak to a third-party image host, analytics beacon, or
      // anything else a future feature adds.
      http.get('https://someone-else.example/pixel.png').subscribe();
      const req = backend.expectOne('https://someone-else.example/pixel.png');
      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush({});
    });

    it('sends no Authorization header when signed out', () => {
      tokens.clearAccessToken();
      http.get(BASE + 'api/account').subscribe();
      const req = backend.expectOne(BASE + 'api/account');
      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush({});
    });
  });

  describe('authRefreshInterceptor', () => {
    it('refreshes once on 401 and REPLAYS the request with the new token', done => {
      http.get(BASE + 'api/account').subscribe(() => done());

      backend.expectOne(BASE + 'api/account').flush({}, { status: 401, statusText: 'Unauthorized' });

      const replay = backend.expectOne(BASE + 'api/account');
      // The replay must carry the refreshed token, not the one that just failed.
      expect(replay.request.headers.get('Authorization')).toBe('Bearer fresh-token');
      expect(auth.refresh).toHaveBeenCalledTimes(1);
      replay.flush({ login: 'nurse' });
    });

    it('gives up after ONE retry rather than spending another token', done => {
      http.get(BASE + 'api/account').subscribe({
        error: () => {
          expect(auth.refresh).toHaveBeenCalledTimes(1);
          done();
        },
      });

      backend.expectOne(BASE + 'api/account').flush({}, { status: 401, statusText: 'Unauthorized' });
      backend.expectOne(BASE + 'api/account').flush({}, { status: 401, statusText: 'Unauthorized' });
    });

    it('does not refresh for /api/auth/refresh itself — that would recurse', done => {
      http.post(BASE + 'api/auth/refresh', {}).subscribe({
        error: () => {
          expect(auth.refresh).not.toHaveBeenCalled();
          done();
        },
      });
      backend.expectOne(BASE + 'api/auth/refresh').flush({}, { status: 401, statusText: 'Unauthorized' });
    });

    it('does not refresh for a failed login — that is just wrong credentials', done => {
      http.post(BASE + 'api/authenticate', {}).subscribe({
        error: () => {
          expect(auth.refresh).not.toHaveBeenCalled();
          done();
        },
      });
      backend.expectOne(BASE + 'api/authenticate').flush({}, { status: 401, statusText: 'Unauthorized' });
    });

    it('does not refresh when nobody is signed in', done => {
      auth.isAuthenticated.mockReturnValue(false);
      http.get(BASE + 'api/account').subscribe({
        error: () => {
          expect(auth.refresh).not.toHaveBeenCalled();
          done();
        },
      });
      backend.expectOne(BASE + 'api/account').flush({}, { status: 401, statusText: 'Unauthorized' });
    });

    it('leaves non-401 failures completely alone', done => {
      http.get(BASE + 'api/account').subscribe({
        error: () => {
          expect(auth.refresh).not.toHaveBeenCalled();
          done();
        },
      });
      backend.expectOne(BASE + 'api/account').flush('nope', { status: 500, statusText: 'Server Error' });
    });

    it('propagates a failed refresh instead of retrying blindly', done => {
      auth.refresh.mockReturnValue(throwError(() => new SessionExpiredError()));

      http.get(BASE + 'api/account').subscribe({
        error: (error: unknown) => {
          expect(error).toBeInstanceOf(SessionExpiredError);
          done();
        },
      });
      backend.expectOne(BASE + 'api/account').flush({}, { status: 401, statusText: 'Unauthorized' });
    });
  });

  /**
   * Who answered the 401 — backlog item 161.
   *
   * A sibling product refusing one call is that product's authorisation decision, not
   * evidence about the token this gateway issued. Refreshing on it spends a rotation
   * that buys nothing and gets the same 401 back.
   */
  describe('authRefreshInterceptor: a foreign service does not buy a rotation', () => {
    const sibling = BASE + 'services/patientservice/api/clinical-cases/42/archive';
    const own = BASE + 'services/professionalservice/api/duty-roster';

    it('does NOT refresh for a 401 from a sibling service', done => {
      http.post(sibling, {}).subscribe({
        error: (error: unknown) => {
          expect(auth.refresh).not.toHaveBeenCalled();
          // The sibling's own answer reaches the caller, not a SessionExpiredError.
          expect(error).toBeInstanceOf(HttpErrorResponse);
          expect((error as HttpErrorResponse).status).toBe(401);
          done();
        },
      });
      backend.expectOne(sibling).flush({}, { status: 401, statusText: 'Unauthorized' });
    });

    it('DOES refresh and replay for a 401 from professionalservice', done => {
      http.get(own).subscribe(() => done());

      backend.expectOne(own).flush({}, { status: 401, statusText: 'Unauthorized' });

      const replay = backend.expectOne(own);
      expect(auth.refresh).toHaveBeenCalledTimes(1);
      expect(replay.request.headers.get('Authorization')).toBe('Bearer fresh-token');
      replay.flush({ shifts: [] });
    });

    it('treats an UNRECOGNISED routed service as foreign', done => {
      // The property that makes the next cross-stack call safe without anyone editing
      // this file. `adminservice` is the one row 163 is about; the invented name proves
      // the default rather than the entry.
      const unknown = BASE + 'services/somethingservice/api/whatever';
      http.get(unknown).subscribe({
        error: () => {
          expect(auth.refresh).not.toHaveBeenCalled();
          done();
        },
      });
      backend.expectOne(unknown).flush({}, { status: 401, statusText: 'Unauthorized' });
    });

    it('treats a 401 from ANOTHER HOST as foreign', done => {
      // `authInterceptor` attaches no token off-prefix, so this 401 cannot be about our
      // token and no refresh could change it.
      const elsewhere = 'https://someone-else.example/api/thing';
      http.get(elsewhere).subscribe({
        error: () => {
          expect(auth.refresh).not.toHaveBeenCalled();
          done();
        },
      });
      backend.expectOne(elsewhere).flush({}, { status: 401, statusText: 'Unauthorized' });
    });

    it('DOES refresh for a sibling 401 when our own access token is locally stale', done => {
      // The access token lives 15 minutes, so a sibling 401 after a quiet spell is far
      // more likely to be our expiry than the sibling's refusal — and the rotation it
      // costs was due anyway. Without this, a clinician archiving a case more than 15
      // minutes after their last call would simply be told no.
      tokens.setAccessToken('stale-token', 0);

      http.post(sibling, {}).subscribe(() => done());

      backend.expectOne(sibling).flush({}, { status: 401, statusText: 'Unauthorized' });

      const replay = backend.expectOne(sibling);
      expect(auth.refresh).toHaveBeenCalledTimes(1);
      expect(replay.request.headers.get('Authorization')).toBe('Bearer fresh-token');
      replay.flush({});
    });
  });
});
