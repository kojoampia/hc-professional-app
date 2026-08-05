import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { throwError } from 'rxjs';

import { NetworkService } from '../native/network.service';

/**
 * Fails GETs fast when the device is known to be offline.
 *
 * Without this, an offline request sits until the platform's connect timeout —
 * tens of seconds on a mobile stack — and the screen shows a spinner the whole
 * time, even though the cache could have answered instantly. Failing immediately
 * lets `cachedResource` fall back to cached data in the same frame.
 *
 * Only GETs. A mutation must never be quietly swallowed: MOB6 ships no offline
 * write queue, so a POST while offline has to surface as a real failure the user
 * can see and retry, not vanish into a synthetic error that looks like success.
 */
export const offlineInterceptor: HttpInterceptorFn = (request, next) => {
  const network = inject(NetworkService);

  if (request.method === 'GET' && !network.connected()) {
    return throwError(
      () =>
        new HttpErrorResponse({
          status: 0,
          statusText: 'Offline',
          url: request.url,
          error: new Error('Device is offline'),
        }),
    );
  }
  return next(request);
};
