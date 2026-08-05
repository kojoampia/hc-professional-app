import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

import { ApplicationConfigService } from '../config/application-config.service';
import type { Account } from './account.model';

/**
 * The signed-in account.
 *
 * Adapted from `web/src/main/webapp/app/core/auth/account.service.ts` (web commit
 * 48a12fc). Two deliberate simplifications: state is a signal rather than a
 * `ReplaySubject` (every consumer in this app reads it synchronously in a template),
 * and it does not navigate — routing on identity belongs to the guards, not to a
 * service that happens to fetch a profile.
 */
@Injectable({ providedIn: 'root' })
export class AccountService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApplicationConfigService);

  private readonly accountSignal = signal<Account | null>(null);
  readonly account = this.accountSignal.asReadonly();
  readonly isAuthenticated = computed(() => this.accountSignal() !== null);

  /** Fetches `/api/account` and caches it. Resolves to null when unauthenticated. */
  identity(force = false): Observable<Account | null> {
    if (this.accountSignal() !== null && !force) {
      return of(this.accountSignal());
    }
    return this.http.get<Account>(this.config.getEndpointFor('api/account')).pipe(
      tap(account => this.accountSignal.set(account)),
      catchError(() => {
        this.accountSignal.set(null);
        return of(null);
      }),
    );
  }

  clear(): void {
    this.accountSignal.set(null);
  }

  hasAnyAuthority(authorities: string[] | string): boolean {
    const account = this.accountSignal();
    if (!account) {
      return false;
    }
    const wanted = Array.isArray(authorities) ? authorities : [authorities];
    return account.authorities.some(authority => wanted.includes(authority));
  }
}
