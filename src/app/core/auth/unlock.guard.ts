import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from './auth.service';

/**
 * Gates the signed-in area.
 *
 * Deliberately checks only for a live access token in memory. It does NOT try to
 * refresh: a guard that performs I/O makes every navigation await the network, and
 * the cold-start refresh belongs to the unlock screen, which can show progress and
 * a biometric prompt. The guard's job is to decide, not to acquire.
 */
export const unlockGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) {
    return true;
  }
  // Straight to /login: the cold-start restore has already run in the app shell by
  // the time any route is activated, so reaching here means there is no session.
  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};
