import { Routes } from '@angular/router';

import { unlockGuard } from './core/auth/unlock.guard';

/**
 * MOB5 ships the auth shell. The four Phase 1 tabs (Today, Messages, Documents, Me)
 * land in MOB6-MOB11 and will replace `/diagnostics` as the signed-in landing route.
 *
 * `/unlock` is the entry point rather than a guard on `''`: restoring a session needs
 * a biometric prompt and a network round trip, which a guard cannot show progress for.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'diagnostics' },
  {
    path: 'unlock',
    loadComponent: () => import('./auth/unlock.page').then(m => m.UnlockPage),
  },
  {
    path: 'login',
    loadComponent: () => import('./auth/login.page').then(m => m.LoginPage),
  },
  {
    path: 'diagnostics',
    canActivate: [unlockGuard],
    loadComponent: () => import('./shell/diagnostics.page').then(m => m.DiagnosticsPage),
  },
  {
    // MOB2 design-system gallery. Deliberately ungated — it renders no data and is
    // the surface the device smoke checklist opens to check theming and dark mode.
    path: 'theme',
    loadComponent: () => import('./shell/theme-gallery.page').then(m => m.ThemeGalleryPage),
  },
  { path: '**', redirectTo: 'diagnostics' },
];
