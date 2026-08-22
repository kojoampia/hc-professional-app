import { Routes } from '@angular/router';

import { unlockGuard } from './core/auth/unlock.guard';

/**
 * Today, Messages, Documents and Me are children of the tab bar (MOB11). They keep their
 * top-level URLs — /today, /messages — because deep links from a push notification target
 * them directly, and a notification that opened the wrong tab would be worse than one that
 * opened nothing.
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
    path: '',
    loadComponent: () => import('./shell/tabs.page').then(m => m.TabsPage),
    children: [
      {
        path: 'today',
        canActivate: [unlockGuard],
        loadComponent: () => import('./features/today/today.page').then(m => m.TodayPage),
      },
      {
        path: 'messages',
        canActivate: [unlockGuard],
        loadComponent: () => import('./features/messages/messages.page').then(m => m.MessagesPage),
      },
      {
        path: 'documents',
        canActivate: [unlockGuard],
        loadComponent: () => import('./features/documents/documents.page').then(m => m.DocumentsPage),
      },
      {
        path: 'me',
        canActivate: [unlockGuard],
        loadComponent: () => import('./features/me/me.page').then(m => m.MePage),
      },
    ],
  },
  {
    // Same reasoning as patients: the queue is where a clinician goes to work, not where they live.
    path: 'cases',
    canActivate: [unlockGuard],
    loadComponent: () => import('./features/cases/cases.page').then(m => m.CasesPage),
  },
  {
    // Pushed, like the roster: a caseload is somewhere a clinician goes when they need it, and the
    // four-tab shell is the app's shape.
    path: 'patients',
    canActivate: [unlockGuard],
    loadComponent: () => import('./features/patients/patients.page').then(m => m.PatientsPage),
  },
  {
    // Pushed from Today rather than made a fifth tab: the four-tab shell is the app's shape, and a
    // calendar is somewhere a clinician goes occasionally rather than a place they live.
    path: 'roster',
    canActivate: [unlockGuard],
    loadComponent: () => import('./features/roster/roster.page').then(m => m.RosterPage),
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
