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

  /**
   * When the case was retired, or `null` while it is live.
   *
   * <p><b>This is the one field on this DTO a client may not ignore</b> (`../docs/backlog.md` items
   * 82 and 104). The queue and the patient's case list exclude archived cases, so this endpoint is
   * the only one that serves one — and a retired diagnosis rendered as current clinical prose is,
   * in `PatientDtos`' own words, "a worse answer than the 404 that used to be given". The screen
   * says so with `hpd-archived-banner`.
   *
   * <p>The service sends `null` rather than omitting the key, so falsiness is the test either way.
   * Both spellings matter in practice: a build of this app talking to a service that predates item
   * 82 receives no key at all, and must then say nothing rather than guess.
   */
  archivedAt: string | null;
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
 * <p>The PATCH goes the same way, for the same scoping reason. An earlier version of this note gave
 * a second, security reason — that patientservice's write gate passed for any authenticated
 * non-patient caller — and that was **wrong**: re-probed on 2026-08-23, a carer PATCHing a diagnosis
 * there gets 403, because their `ScopeOfPractice` does not grant a carer DIAGNOSIS. The original
 * probe's 400 came from a malformed body, before authorisation was reached.
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

  /**
   * The one call in this file that goes to patientservice directly, and the exception is reasoned.
   *
   * <p>professionalservice has no archive endpoint — `CaseQueueResource` is a single GET, and
   * `PatientResource` proxies only the read and the PATCH. The scoping argument above is about
   * <em>list</em> reads: `/api/clinical-cases` unfiltered hands back every case in the estate. It
   * does not apply to one case addressed by id, which patientservice scopes itself — its archive
   * checks `patientScope.isVisible` before it will admit the case exists, answering 404 rather than
   * 403 so that a caller cannot learn a case exists by trying to retire it.
   *
   * <p>Same URL `web/`'s `clinical-case-api.service.ts` already calls, which is the other half of the
   * decision: two clients archiving through two different paths is a difference with no reason
   * behind it. Adding a passthrough to professionalservice was the alternative and was rejected as
   * a hop that would relay the caller's token unchanged and check nothing the sibling does not.
   */
  private get clinicalCasesUrl(): string {
    return this.config.getEndpointFor('api/clinical-cases', 'patientservice');
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

  /**
   * Retires a case from the working queue.
   *
   * <p>A POST rather than a PATCH over `archivedAt`, which is the server's design and not this
   * client's preference: it stamps who archived it and when, and both are records rather than
   * claims a client gets to make.
   *
   * <p><b>The reason is required and is not defaulted.</b> The server answers 400 `reasonrequired`
   * to a blank one and says why — an archive with no reason is the delete that patient data does not
   * allow. So the screen asks for it rather than sending something like "Archived from mobile".
   *
   * <p>Doctor only. `ROLE_ADMIN`, and every other discipline, gets 403 by the server's deliberate
   * choice — see `hasClinicalPermission`'s `archiveCase` branch, which mirrors it so the button is
   * not offered rather than queued and then refused.
   */
  archive(caseId: string, reason: string): Observable<unknown> {
    return this.http.post(`${this.clinicalCasesUrl}/${encodeURIComponent(caseId)}/archive`, { reason });
  }
}
