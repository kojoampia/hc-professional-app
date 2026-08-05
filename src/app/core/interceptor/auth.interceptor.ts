import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { ApplicationConfigService } from '../config/application-config.service';
import { SecureTokenStore } from '../native/secure-token-store.service';

/**
 * Attaches the bearer token.
 *
 * Adapted from `web/src/main/webapp/app/core/interceptor/auth.interceptor.ts`
 * (web commit 48a12fc), as a functional interceptor.
 *
 * The origin check is the important part, and it means more here than it does in
 * web. There, `getEndpointFor('')` is `''`, so the guard passes every relative URL
 * and effectively never rejects anything. Here the prefix is an absolute base URL,
 * so this genuinely stops the access token from being attached to a request to any
 * other host — a third-party image, an analytics beacon, anything a future feature
 * adds. Do not "simplify" it away.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const config = inject(ApplicationConfigService);
  const tokens = inject(SecureTokenStore);

  if (!request.url.startsWith(config.getEndpointPrefix())) {
    return next(request);
  }

  const token = tokens.accessToken();
  if (!token) {
    return next(request);
  }

  return next(request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
