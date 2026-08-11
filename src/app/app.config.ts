import { APP_INITIALIZER, ApplicationConfig, importProvidersFrom, inject, provideZoneChangeDetection } from '@angular/core';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { RouteReuseStrategy, provideRouter } from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular/standalone';

import { routes } from './app.routes';
import { BundledTranslateLoader, LanguageService } from './core/i18n/language.service';
import { authInterceptor } from './core/interceptor/auth.interceptor';
import { authRefreshInterceptor } from './core/interceptor/auth-refresh.interceptor';
import { offlineInterceptor } from './core/interceptor/offline.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    // REQUIRED by ion-router-outlet, and easy to omit because a single-route app
    // works without it. Without this strategy the outlet never marks the pages it
    // leaves as `ion-page-hidden`, so every visited page stays painted on top of the
    // next one — with three routes that meant the unlock spinner sat over the login
    // form, which sat over Today. It only shows up once the app has a real stack.
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideRouter(routes),
    // Order matters: authInterceptor attaches the token on the way out, and
    // authRefreshInterceptor sits outside it so that when it replays a request after
    // a refresh, the replay carries the NEW token rather than the stale one that
    // just 401'd.
    // Order matters. offlineInterceptor is outermost so a known-offline GET fails
    // immediately without burning a refresh attempt on it. authInterceptor is
    // innermost so that when authRefreshInterceptor replays a request, the replay
    // picks up the NEW token from the store rather than the stale one that 401'd.
    provideHttpClient(withInterceptors([offlineInterceptor, authRefreshInterceptor, authInterceptor])),
    // No `mode` — Ionic uses the platform default (`ios` on iOS, `md` on Android).
    // Forcing a single mode is the classic "this is a webview" tell. See mobile-app-plan.md.
    provideIonicAngular(),
    // Catalogues are compiled in, so the loader resolves synchronously and the first paint is
    // already translated — see core/i18n/catalogues.ts for why they are not fetched.
    importProvidersFrom(
      TranslateModule.forRoot({
        defaultLanguage: 'en',
        loader: { provide: TranslateLoader, useClass: BundledTranslateLoader },
      }),
    ),
    // Language is resolved before the first page renders. It reads a stored preference, so it is
    // async, and running it here rather than in a component avoids a frame of English for someone
    // who chose German.
    {
      provide: APP_INITIALIZER,
      multi: true,
      useFactory: () => {
        const language = inject(LanguageService);
        return () => language.initialise();
      },
    },
  ],
};
