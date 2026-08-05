import { HttpClient, HttpEvent, HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

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

  /**
   * Uploads a document as multipart/form-data.
   *
   * Emits progress from 0 to 1 and finally the created document. Progress is not
   * decoration: a 3 MB upload on a ward's mobile signal takes long enough that a
   * static spinner reads as a hang, and the clinician retries — producing duplicates
   * in the review queue.
   *
   * The parts match `OnboardingDocumentResource` exactly: `file`, `type`, plus
   * `otherLabel` when the type is OTHER and `expiryDate` when it is LICENSE. The
   * server rejects a LICENSE without an expiry, so the form enforces it first.
   */
  uploadDocument(input: {
    file: Blob;
    filename: string;
    type: DocumentType;
    otherLabel?: string;
    expiryDate?: string;
  }): Observable<UploadProgress> {
    const form = new FormData();
    form.append('file', input.file, input.filename);
    form.append('type', input.type);
    if (input.otherLabel) {
      form.append('otherLabel', input.otherLabel);
    }
    if (input.expiryDate) {
      form.append('expiryDate', input.expiryDate);
    }

    return this.http
      .post<PersonalDocumentDto>(`${this.resourceUrl}/documents`, form, { reportProgress: true, observe: 'events' })
      .pipe(map(event => toProgress(event)));
  }
}

export interface UploadProgress {
  /** 0..1, or null when the total size is unknown. */
  fraction: number | null;
  done: boolean;
  document: PersonalDocumentDto | null;
}

function toProgress(event: HttpEvent<PersonalDocumentDto>): UploadProgress {
  if (event.type === HttpEventType.UploadProgress) {
    return { fraction: event.total ? event.loaded / event.total : null, done: false, document: null };
  }
  if (event.type === HttpEventType.Response) {
    return { fraction: 1, done: true, document: event.body };
  }
  return { fraction: null, done: false, document: null };
}
