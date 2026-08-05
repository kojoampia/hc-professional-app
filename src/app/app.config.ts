import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(),
    // No `mode` — Ionic uses the platform default (`ios` on iOS, `md` on Android).
    // Forcing a single mode is the classic "this is a webview" tell. See mobile-app-plan.md.
    provideIonicAngular(),
  ],
};
