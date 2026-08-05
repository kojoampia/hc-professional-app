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
  { path: '**', redirectTo: 'diagnostics' },
];
