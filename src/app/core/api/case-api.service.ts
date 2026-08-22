import { HttpClient, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApplicationConfigService } from '../config/application-config.service';

export interface CaseSummaryDto {
  id: string;
  /**
   * The patient the case belongs to.
   *
   * <p>Added to the server's contract for this screen: editing goes to
   * `/api/patients/{patientId}/cases/{caseId}`, so without it the queue lists cases that cannot be
   * opened, edited or navigated from.
   */
  patientId: string;
  openedAt: string | null;
  brief: string | null;
  status: string | null;
}

/**
 * One case in full.
 *
 * <p>Fetched separately from the queue rather than carried on every row: `symptoms` and `diagnosis`
 * are unbounded free text, and a twenty-row page of them is kilobytes of clinical prose on a mobile
 * connection to render a summary line of it.
 *
 * <p>There is no recommendations field — not here and not on patientservice's own case. The
 * dashboard migration plan describes a recommendation checklist that was never given anywhere to
 * live, so this screen does not offer one.
 */
export interface CaseDetailDto extends CaseSummaryDto {
  caseNumber: number | null;
  title: string | null;
  closedAt: string | null;
  symptoms: string | null;
  diagnosis: string | null;
}

/** The clinical fields a clinician may edit. Everything else on a case belongs to somebody else. */
export interface CaseUpdateDto {
  symptoms?: string;
  diagnosis?: string;
  brief?: string;
  status?: string;
}

/**
 * The clinician's own case queue.
 *
 * <p><b>Through professionalservice, never patientservice directly.</b> The sibling's
 * `/api/clinical-cases` is generated CRUD with no filters, no paging and — the part that matters —
 * no clinician scope, so a client calling it receives every clinical case in the estate and narrows
 * the list in the browser. That is how the web dashboard works today; it is not something to ship to
 * a phone, both for what it downloads and for what it exposes.
 *
 * <p>The PATCH goes the same way for a second reason, established by probing the deployed stack:
 * patientservice's own write gate passes for any authenticated non-patient caller, so a role that is
 * read-only here could edit a diagnosis by going around. Routed through professionalservice it is
 * behind CLINICAL_MUTATION and the caseload check.
 */
@Injectable({ providedIn: 'root' })
export class CaseApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApplicationConfigService);

  private get queueUrl(): string {
    return this.config.getEndpointFor('api/cases', 'professionalservice');
  }

  private patientCasesUrl(patientId: string): string {
    return this.config.getEndpointFor(`api/patients/${encodeURIComponent(patientId)}/cases`, 'professionalservice');
  }

  /** One page of the caller's open cases, newest first. Archived ones are excluded server-side. */
  queue(page: number, size: number, status?: string): Observable<HttpResponse<CaseSummaryDto[]>> {
    const params: Record<string, string> = { page: String(page), size: String(size) };
    if (status) {
      params['status'] = status;
    }
    return this.http.get<CaseSummaryDto[]>(this.queueUrl, { params, observe: 'response' });
  }

  /**
   * One case in full, for the detail screen.
   *
   * <p>404 for a case outside the caller's caseload — the server answers that rather than 403 on
   * purpose, since "this exists but is not yours" is itself a disclosure about a patient the caller
   * has no relationship with. Treat it as absent, not as a permissions problem.
   */
  detail(patientId: string, caseId: string): Observable<CaseDetailDto> {
    return this.http.get<CaseDetailDto>(`${this.patientCasesUrl(patientId)}/${encodeURIComponent(caseId)}`);
  }

  /**
   * Edits the clinical fields of one case.
   *
   * <p>The patient is in the path because that is what the entitlement check checks against — a
   * case id alone is not authority over it.
   */
  update(patientId: string, caseId: string, changes: CaseUpdateDto): Observable<CaseSummaryDto> {
    return this.http.patch<CaseSummaryDto>(`${this.patientCasesUrl(patientId)}/${encodeURIComponent(caseId)}`, changes);
  }
}
