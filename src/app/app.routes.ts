import { Routes } from '@angular/router';

/**
 * MOB1 ships the bootstrap shell only. The four Phase 1 tabs (Today, Messages,
 * Documents, Me) land in MOB6-MOB11; the auth/unlock routes land in MOB5.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'diagnostics' },
  {
    path: 'diagnostics',
    loadComponent: () => import('./shell/diagnostics.page').then(m => m.DiagnosticsPage),
  },
  {
    // MOB2 design-system gallery: every BridgeCare surface on one screen, for
    // comparison against web/ and for the manual dark-mode check.
    path: 'theme',
    loadComponent: () => import('./shell/theme-gallery.page').then(m => m.ThemeGalleryPage),
  },
  { path: '**', redirectTo: 'diagnostics' },
];
