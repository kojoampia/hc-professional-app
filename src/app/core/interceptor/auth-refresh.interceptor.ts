import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

import { AuthService } from '../auth/auth.service';
import { ApplicationConfigService } from '../config/application-config.service';

/** Endpoints that must never trigger a refresh attempt. */
const isAuthEndpoint = (request: HttpRequest<unknown>, prefix: string): boolean =>
  request.url.startsWith(`${prefix}api/auth/`) || request.url.startsWith(`${prefix}api/authenticate`);

/**
 * On a 401, refreshes once and replays the request.
 *
 * This is where mobile diverges most sharply from web. `web`'s
 * `auth-expired.interceptor.ts` logs the user out on any 401 — correct there,
 * because a browser token is valid for 24 hours and a 401 really does mean the
 * session is over. Here the access token lives 15 minutes by design, so a 401 is
 * the *expected* steady state, not a failure. Logging out on it would sign a
 * clinician out every quarter of an hour.
 *
 * Three rules keep that from going wrong:
 *
 * 1. **Never refresh for the auth endpoints themselves.** A 401 from
 *    `/api/auth/refresh` is the answer, not a problem to solve; retrying would
 *    recurse. A 401 from `/api/authenticate` is simply wrong credentials.
 * 2. **Retry once.** If the replayed request 401s again the session really is
 *    finished, and a second refresh would just spend another token.
 * 3. **Only a 401 means "signed out".** A network failure, timeout or 5xx is
 *    propagated untouched — `AuthService.refresh()` preserves that distinction, so
 *    losing signal mid-refresh surfaces as a failed request rather than a sign-out.
 *    That is the "mid-refresh network drop does not log the user out" gate.
 *
 * Concurrency is handled in `AuthService.refresh()`, which shares one in-flight
 * request: N simultaneous 401s must not become N rotations, since the gateway reads
 * a replayed token as reuse and revokes the whole family.
 */
export const authRefreshInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const prefix = inject(ApplicationConfigService).getEndpointPrefix();

  return next(request).pipe(
    catchError((error: unknown) => {
      const isUnauthorized = error instanceof HttpErrorResponse && error.status === 401;
      if (!isUnauthorized || isAuthEndpoint(request, prefix) || !auth.isAuthenticated()) {
        return throwError(() => error);
      }

      // Replay WITHOUT setting the header. `authInterceptor` is registered inside
      // this one, so it re-attaches from SecureTokenStore on the way out — and
      // `refresh()` has just written the new token there. Setting it here as well
      // would be overwritten by that inner interceptor anyway, which makes the
      // explicit header actively misleading: it would look like the retry controls
      // the credential when the store does.
      return auth.refresh().pipe(switchMap(() => next(request)));
    }),
  );
};
