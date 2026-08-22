import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApplicationConfigService } from '../config/application-config.service';

/**
 * The shortest a password may be, and the longest.
 *
 * <p>Copied from the gateway's `ManagedUserVM` (`PASSWORD_MIN_LENGTH`/`PASSWORD_MAX_LENGTH`). The
 * server rejects outside this range with a 400 carrying a JHipster problem type the phone would
 * have to parse to say anything useful, so the check is duplicated here to produce a sentence a
 * clinician can act on. **If the gateway's constants change, change these** — the failure mode is
 * a form that accepts something the server then refuses, which reads as the app being broken.
 */
export const PASSWORD_MIN_LENGTH = 4;
export const PASSWORD_MAX_LENGTH = 100;

export interface PasswordChange {
  currentPassword: string;
  newPassword: string;
}

export interface PasswordResetFinish {
  key: string;
  newPassword: string;
}

/**
 * The signed-in account, and the password flows around it.
 *
 * <p><b>Served by the gateway, not professionalservice</b> — the gateway owns users, authentication
 * and JWT issuance; `api/` only validates tokens. So every URL here is built with no microservice
 * argument, and adding one would point at a service that has no account resource at all.
 *
 * <p>There is no registration here and there never will be. Self-registration in an app store
 * invites Apple 5.1.1 scrutiny plus a mandatory in-app account-deletion path, and this app is for
 * clinicians an administrator has already invited. Reset only.
 */
@Injectable({ providedIn: 'root' })
export class AccountApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApplicationConfigService);

  private get resourceUrl(): string {
    return this.config.getEndpointFor('api/account');
  }

  /** Changes the password of the signed-in account. 400 means the current password was wrong. */
  changePassword(request: PasswordChange): Observable<void> {
    return this.http.post<void>(`${this.resourceUrl}/change-password`, request);
  }

  /**
   * Asks for a reset email.
   *
   * <p><b>Answers 200 whether or not the address exists</b>, deliberately — the gateway logs the
   * miss rather than reporting it, so the endpoint cannot be used to discover which clinicians
   * have accounts. The screen must therefore say "if that address is registered, an email is on its
   * way" and not "sent", because it does not know.
   *
   * <p>The body is a <b>bare string</b>, not JSON. The gateway takes `@RequestBody String mail`, so
   * Angular's `text/plain` default is exactly right and wrapping it in an object gets a 400 whose
   * message says nothing about the shape.
   */
  requestPasswordReset(mail: string): Observable<void> {
    return this.http.post<void>(`${this.resourceUrl}/reset-password/init`, mail);
  }

  /**
   * Finishes a reset with the key from the email.
   *
   * <p><b>The key is pasted, not followed.</b> This app registers no deep link — `AndroidManifest`
   * carries only the LAUNCHER intent filter and there is no `associatedDomains` entitlement — so
   * the email's link opens a browser, not the app. Asking for the key is honest about that;
   * pretending a tap will return here is what would actually strand someone.
   */
  finishPasswordReset(request: PasswordResetFinish): Observable<void> {
    return this.http.post<void>(`${this.resourceUrl}/reset-password/finish`, request);
  }
}
