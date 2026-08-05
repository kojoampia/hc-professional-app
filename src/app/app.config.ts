import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';

import { routes } from './app.routes';
import { authInterceptor } from './core/interceptor/auth.interceptor';
import { authRefreshInterceptor } from './core/interceptor/auth-refresh.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    // Order matters: authInterceptor attaches the token on the way out, and
    // authRefreshInterceptor sits outside it so that when it replays a request after
    // a refresh, the replay carries the NEW token rather than the stale one that
    // just 401'd.
    provideHttpClient(withInterceptors([authRefreshInterceptor, authInterceptor])),
    // No `mode` — Ionic uses the platform default (`ios` on iOS, `md` on Android).
    // Forcing a single mode is the classic "this is a webview" tell. See mobile-app-plan.md.
    provideIonicAngular(),
  ],
};
