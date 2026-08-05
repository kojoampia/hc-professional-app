import { Routes } from '@angular/router';

import { unlockGuard } from './core/auth/unlock.guard';

/**
 * MOB6 makes Today the signed-in landing route. Messages, Documents and Me land in
 * MOB7-MOB11, at which point these become children of a tab bar.
 *
 * There is deliberately no `/unlock` route: the cold-start decision is made by
 * SessionBootstrapper behind the app shell's splash, so the router is told exactly
 * once where to go. See AppComponent.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'today' },
  {
    path: 'login',
    loadComponent: () => import('./auth/login.page').then(m => m.LoginPage),
  },
  {
    path: 'today',
    canActivate: [unlockGuard],
    loadComponent: () => import('./features/today/today.page').then(m => m.TodayPage),
  },
  {
    // MOB1 bootstrap probe. Kept reachable: it is the first screen the device smoke
    // checklist opens, and the only place that reports every native wrapper at once.
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
  { path: '**', redirectTo: 'today' },
];
