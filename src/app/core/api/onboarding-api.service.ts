import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApplicationConfigService } from '../config/application-config.service';

/** Mirrors `api/domain/enumeration/OnboardingStatus`. */
export type OnboardingStatus =
  | 'APPLICATION_STARTED'
  | 'PROFILE_COMPLETED'
  | 'CREDENTIAL_REVIEW'
  | 'RETURNED_FOR_CORRECTION'
  | 'REJECTED'
  | 'APPROVED'
  | 'ORGANIZATION_ASSIGNED'
  | 'AUTHORITY_ASSIGNED'
  | 'ROSTER_CONFIGURED'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'EXPIRED'
  | 'DEACTIVATED';

/**
 * The statuses that mean "this clinician is working".
 *
 * Everything else sends the user to the web portal rather than into the app: this
 * app is for active clinicians, and the applicant wizard is deliberately out of
 * scope (mobile-app-plan.md § Scope).
 */
export const WORKING_STATUSES: readonly OnboardingStatus[] = ['ROSTER_CONFIGURED', 'ACTIVE'];

export const isWorkingClinician = (status: OnboardingStatus | null | undefined): boolean =>
  status !== null && status !== undefined && WORKING_STATUSES.includes(status);

export type DocumentType =
  | 'CERTIFICATE'
  | 'LICENSE'
  | 'PASSPORT'
  | 'GHANACARD'
  | 'DRIVERLICENSE'
  | 'VOTERCARD'
  | 'PASSPHOTO'
  | 'NHIS'
  | 'OTHER';

export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface OnboardingApplicationDto {
  id: string;
  accountId: string;
  requestedRole: string;
  status: OnboardingStatus;
  source?: string | null;
  submittedAt?: string | null;
}

export interface PersonalDocumentDto {
  id: string;
  type: DocumentType;
  otherLabel?: string | null;
  verificationStatus: VerificationStatus;
  expiryDate?: string | null;
  sizeBytes?: number | null;
  name?: string | null;
}

@Injectable({ providedIn: 'root' })
export class OnboardingApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApplicationConfigService);

  private get resourceUrl(): string {
    return this.config.getEndpointFor('api/onboarding', 'professionalservice');
  }

  /** The caller's own application. 404 when they have never applied. */
  myApplication(): Observable<OnboardingApplicationDto> {
    return this.http.get<OnboardingApplicationDto>(`${this.resourceUrl}/applications/me`);
  }

  /** The caller's own documents. Binary is always stripped server-side. */
  myDocuments(): Observable<PersonalDocumentDto[]> {
    return this.http.get<PersonalDocumentDto[]>(`${this.resourceUrl}/documents`);
  }
}
