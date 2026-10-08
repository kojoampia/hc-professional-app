import { HttpClient, HttpEvent, HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, from } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

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

/**
 * Mirrors `api/domain/enumeration/DocumentType`, and carries the same nine values `web/`'s
 * `healthConnect.onboarding.documentTypes.*` names.
 *
 * <p><b>An array rather than a bare union</b>, for the reason `duty-roster-api.service.ts`'s
 * `DUTY_ROSTER_SHIFTS` gives: a union of string literals cannot be enumerated at runtime, so
 * nothing could ask whether the four catalogues named every value. That question had never been
 * asked here — the documents screen rendered `type.toLowerCase()` on both of its surfaces, so
 * `license` and `nhis` reached a German reader untouched and no gate could see it (backlog item
 * 58). `document-type-names.spec.ts` beside the catalogues is what asks it now, and it needs this
 * list to do so.
 */
export const DOCUMENT_TYPES = [
  'CERTIFICATE',
  'LICENSE',
  'PASSPORT',
  'GHANACARD',
  'DRIVERLICENSE',
  'VOTERCARD',
  'PASSPHOTO',
  'NHIS',
  'OTHER',
] as const;

/** The union, derived from the list above rather than written twice. */
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

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
  /**
   * Set once this document has been replaced by a newer one of the same credential (backlog item 20).
   * Absent means current — the server stores no field at all on rows that predate the marker, and
   * `null` is what an unreplaced row reports.
   */
  supersededAt?: string | null;
}

@Injectable({ providedIn: 'root' })
export class OnboardingApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApplicationConfigService);

  private get resourceUrl(): string {
    return this.config.getEndpointFor('api/onboarding', 'professionalservice');
  }

  /**
   * The applicant's own documents are no longer under `api/onboarding` (profile.md step 3, T2).
   *
   * A second base rather than a second service: this file is also the home of `DOCUMENT_TYPES`,
   * which `core/i18n/document-type-names.spec.ts` reads, and of the working-status helpers the Today
   * tab uses. Splitting it would move three unrelated things to move two calls.
   *
   * ⚠ What must not happen is these calls staying on `api/onboarding/documents` — the server
   * mappings are gone, so that would be a consumer reading where nobody writes.
   */
  private get documentUrl(): string {
    return this.config.getEndpointFor('api/personal-document', 'professionalservice');
  }

  /** The caller's own application. 404 when they have never applied. */
  myApplication(): Observable<OnboardingApplicationDto> {
    return this.http.get<OnboardingApplicationDto>(`${this.resourceUrl}/applications/me`);
  }

  /** The caller's own documents. Binary is always stripped server-side. */
  myDocuments(): Observable<PersonalDocumentDto[]> {
    return this.http.get<PersonalDocumentDto[]>(this.documentUrl);
  }

  /**
   * Uploads a document as the JSON `PersonalDocument` the service specifies.
   *
   * Emits progress from 0 to 1 and finally the created document. Progress is not
   * decoration: a 3 MB upload on a ward's mobile signal takes long enough that a
   * static spinner reads as a hang, and the clinician retries — producing duplicates
   * in the review queue.
   *
   * The body matches `OwnPersonalDocumentResource.PersonalDocumentUpload` exactly:
   * `name`, `type`, `data`, `dataContentType`, plus `otherLabel` when the type is
   * OTHER and `expiryDate` when it is LICENSE. The server rejects a LICENSE without
   * an expiry, so the form enforces it first.
   *
   * ⚠ **This sent `multipart/form-data` until T2, and three things about the change matter here
   * more than they do on the web.** The blob has to be read and base64-encoded before the request
   * exists, so the first progress event arrives a beat later than it used to — the store's spinner
   * covers it, and `fraction: null` is already its "unknown" state. Base64 is 4/3 of the file, so a
   * capture that `ImageCompressor` brought under 4 MB now travels as ~5.3 MB: that is still inside
   * the service's 5 MB check on the *decoded* bytes, which is what the ladder was tuned against, but
   * the headroom against nginx's 8 MB cap is ~1.3 MB rather than 4 MB. And `dataContentType` now
   * carries what the blob says it is rather than what a form part's header said — which is the same
   * value, and is still verified against the magic bytes server-side, so a HEIC that slipped through
   * as `image/jpeg` is refused exactly as before.
   */
  uploadDocument(input: {
    file: Blob;
    filename: string;
    type: DocumentType;
    otherLabel?: string;
    expiryDate?: string;
  }): Observable<UploadProgress> {
    return from(base64Of(input.file)).pipe(
      switchMap(data =>
        this.http
          .post<PersonalDocumentDto>(
            this.documentUrl,
            {
              name: input.filename,
              type: input.type,
              data,
              dataContentType: input.file.type,
              otherLabel: input.otherLabel ?? null,
              expiryDate: input.expiryDate ?? null,
              supersedesDocumentId: null,
            },
            { reportProgress: true, observe: 'events' },
          )
          .pipe(map(event => toProgress(event))),
      ),
    );
  }
}

/**
 * The blob's bytes as base64, without the `data:` prefix a data URL carries.
 *
 * `FileReader.readAsDataURL` rather than `arrayBuffer()` plus `btoa`: the latter needs a binary
 * string, and the obvious way to build one — `String.fromCharCode(...bytes)` — blows the call stack
 * on a multi-megabyte capture. The reader encodes natively, in one pass, and exists in the Capacitor
 * WebView and in jsdom alike.
 */
function base64Of(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    // `reader.error` is a DOMException and is what a caller wants; the fallback is only for the case
    // the File API allows but does not describe, and it is deliberately NOT a sentence — this never
    // reaches a screen, and `untranslated-literals.spec.ts` rightly cannot tell a thrown message
    // from a caption. `NotReadableError` is the File API's own name for this failure.
    reader.onerror = () => reject(reader.error ?? new DOMException('', 'NotReadableError'));
    reader.onload = () => {
      const result = reader.result as string;
      // `data:<mime>;base64,<payload>` — everything after the comma is the payload, and a comma
      // cannot occur inside base64 itself.
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
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
