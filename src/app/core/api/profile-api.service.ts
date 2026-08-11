import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApplicationConfigService } from '../config/application-config.service';

/**
 * The clinician's own profile.
 *
 * <p>Only the fields the Me page edits. The server document carries far more — identity card type
 * and number, address, emergency contact, notification preferences — and `upsertOwnProfile` merges
 * rather than replaces, so sending a partial body is the intended use and not a truncation.
 */
export interface ClinicianProfileDto {
  id?: string;
  accountId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  mobilePhone?: string;
}

/**
 * Reads and writes the signed-in clinician's profile.
 *
 * <p>Goes through `/api/onboarding/profile`, which is `.authenticated()` rather than role-gated —
 * an applicant holding only `ROLE_USER` must be able to fill in their own details before any
 * clinical authority is granted. The server force-sets `accountId` to the caller on write, so a
 * client cannot edit somebody else's profile by supplying an id.
 */
@Injectable({ providedIn: 'root' })
export class ProfileApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApplicationConfigService);

  private get resourceUrl(): string {
    return this.config.getEndpointFor('api/onboarding/profile', 'professionalservice');
  }

  mine(): Observable<ClinicianProfileDto> {
    return this.http.get<ClinicianProfileDto>(this.resourceUrl);
  }

  /** Upserts; the response is the stored document, which is what the page then shows. */
  save(profile: ClinicianProfileDto): Observable<ClinicianProfileDto> {
    return this.http.put<ClinicianProfileDto>(this.resourceUrl, profile);
  }
}
