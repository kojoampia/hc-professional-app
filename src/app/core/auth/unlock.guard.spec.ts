import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { provideRouter } from '@angular/router';

import { AuthService } from './auth.service';
import { unlockGuard } from './unlock.guard';

describe('unlockGuard', () => {
  let authenticated: boolean;

  const run = (url: string): boolean | UrlTree =>
    TestBed.runInInjectionContext(() => unlockGuard({} as never, { url } as never)) as boolean | UrlTree;

  beforeEach(() => {
    authenticated = false;
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: { isAuthenticated: () => authenticated } }],
    });
  });

  it('admits a live session', () => {
    authenticated = true;
    expect(run('/diagnostics')).toBe(true);
  });

  it('sends everyone else to /login', () => {
    // Straight to /login, not to an unlock route: the cold-start restore runs in the
    // app shell (SessionBootstrapper) before any route activates, so reaching the
    // guard at all means there is no session to restore.
    const result = run('/diagnostics');
    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toContain('/login');
  });

  it('carries the attempted URL so the user lands where they were going', () => {
    const serialized = TestBed.inject(Router).serializeUrl(run('/documents/42') as UrlTree);
    expect(serialized).toContain('returnUrl=%2Fdocuments%2F42');
  });

  it('resolves synchronously — a guard that awaits the network stalls every navigation', () => {
    // The cold-start refresh belongs to the unlock screen, which can show progress
    // and prompt for biometrics. A guard returning a Promise/Observable would make
    // every navigation wait on I/O.
    const result = run('/diagnostics');
    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof (result as { subscribe?: unknown }).subscribe).toBe('undefined');
  });
});
