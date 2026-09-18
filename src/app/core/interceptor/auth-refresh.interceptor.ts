import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

import { AuthService } from '../auth/auth.service';
import { ApplicationConfigService } from '../config/application-config.service';
import { SecureTokenStore } from '../native/secure-token-store.service';

/** Endpoints that must never trigger a refresh attempt. */
const isAuthEndpoint = (request: HttpRequest<unknown>, prefix: string): boolean =>
  request.url.startsWith(`${prefix}api/auth/`) || request.url.startsWith(`${prefix}api/authenticate`);

/**
 * Reads the routed microservice name back off a URL that is already known to start
 * with our endpoint prefix.
 *
 * `ApplicationConfigService.getEndpointFor(api, microservice?)` builds every backend
 * URL this app calls: `<prefix>services/<microservice>/<api>` when a microservice is
 * named, `<prefix><api>` otherwise. So the answering service is recoverable from the
 * URL alone, and `null` means the gateway answered directly.
 *
 * Anchored at the start of what follows the prefix rather than on any `/services/`
 * segment, which is the one place this must not simply copy `web/`'s regex: there the
 * prefix is `''` and a leading-segment anchor is the same thing, but here the prefix is
 * an absolute base URL from `src/environments/`. Matching a bare `services/` anywhere
 * would misread a gateway path the day that base URL is given a path component.
 */
const routedService = (url: string, prefix: string): string | null => /^services\/([^/?#]+)/.exec(url.slice(prefix.length))?.[1] ?? null;

/**
 * The routed microservices whose 401 is evidence about *this* app's session.
 *
 * `professionalservice` validates the token this gateway issued, with the same key, and
 * separates the two failures: `BearerTokenAuthenticationEntryPoint` answers 401 when the
 * token itself fails validation, `BearerTokenAccessDeniedHandler` answers 403 when a
 * valid token merely lacks the authority. So a 401 from it really is about the token.
 *
 * Every other routed service belongs to another product. The stacks share a signing key
 * and **not** a user store, so a sibling's 401 is that product's decision about that one
 * call. An unrecognised name is foreign by default, which is what makes the next
 * cross-stack call safe without anyone remembering this file.
 */
const SESSION_AUTHORITATIVE_SERVICES = ['professionalservice'];

/**
 * On a 401, refreshes once and replays the request.
 *
 * Here the access token lives 15 minutes by design, so a 401 is the *expected* steady
 * state rather than a failure, and the app refreshes through it instead of signing
 * anyone out. Only `AuthService.performRefresh` ends a session, and only on a 401 from
 * `/api/auth/refresh` itself — so session death is keyed on **who answered**.
 *
 * Four rules keep that from going wrong:
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
 * 4. **A refusal that cannot be about our token buys no rotation** — see
 *    {@link couldBeOurToken}.
 *
 * Concurrency is handled in `AuthService.refresh()`, which shares one in-flight
 * request: N simultaneous 401s must not become N rotations, since the gateway reads
 * a replayed token as reuse and revokes the whole family.
 *
 * ⚠ **On `web/`, and why this comment no longer argues from it.** This paragraph used to
 * say that `web/`'s `auth-expired.interceptor.ts` "logs the user out on any 401 — correct
 * there, because a browser token is valid for 24 hours and a 401 really does mean the
 * session is over". The first half was true and stopped being so; the second half was
 * never true, and `../docs/backlog.md` item 156 is the finding — an `adminservice` 401 on
 * one dashboard card signed clinicians out of a session whose own `GET /api/account` had
 * answered 200 moments earlier. `web` commit `087e16b` removed it, and that repo now keys
 * on the same `services/<name>` reading used above. **Nothing in this repository's CI can
 * read `web/`**, which is exactly why a claim about its behaviour rotted here unnoticed —
 * so the rules above are stated as this app's own, and the one sentence that does mention
 * the sibling is pinned to a commit and a dated backlog row that can be checked. See
 * item 161.
 */
export const authRefreshInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const tokens = inject(SecureTokenStore);
  const prefix = inject(ApplicationConfigService).getEndpointPrefix();

  /**
   * Whether this 401 could plausibly be our own access token expiring.
   *
   * Two ways it could not be. A request to another host carried no token at all —
   * `authInterceptor` attaches one only on-prefix — so no rotation could change the
   * answer. And a 401 from a foreign routed service is that product's authorisation
   * decision; refreshing spends a token, replays, and collects the same 401.
   *
   * **The staleness escape is the part that does not copy from `web/`, and the reason is
   * two numbers in one config file.** The gateway issues a browser token good for 24 hours
   * (`token-validity-in-seconds: 86400`, `application-prod.yml`) and a mobile access token
   * good for 15 minutes (`access-token-validity-in-seconds: 900`, `application.yml`). So
   * ignoring a sibling 401 costs `web/` a sign-out that arrives one navigation late, while
   * here a sibling 401 after a quiet spell is *more* likely to be our own expiry than a
   * refusal — and mobile's only sibling call is `POST /clinical-cases/{id}/archive`, a
   * write the clinician initiated. Ignoring it unconditionally would lose that action and
   * make them retry. So when the store already knows the token is at or past expiry,
   * refresh: that rotation was due anyway and is not the wasted one item 161 is about.
   *
   * A token stored without an `expires_in` reads as fresh, so a foreign 401 is not
   * refreshed through. That direction is deliberate — the cost is one failed call the
   * user can repeat, against a rotation spent on every sibling refusal.
   */
  const couldBeOurToken = (url: string): boolean => {
    if (!url.startsWith(prefix)) {
      return false;
    }
    const routed = routedService(url, prefix);
    // A bare path is the gateway itself — the issuer of the token, and the authority on it.
    return routed === null || SESSION_AUTHORITATIVE_SERVICES.includes(routed) || tokens.isAccessTokenStale();
  };

  return next(request).pipe(
    catchError((error: unknown) => {
      const isUnauthorized = error instanceof HttpErrorResponse && error.status === 401;
      if (!isUnauthorized || isAuthEndpoint(request, prefix) || !auth.isAuthenticated() || !couldBeOurToken(request.url)) {
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
