import { HttpClient, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApplicationConfigService } from '../config/application-config.service';

/** A row in the directory. `isChild` is derived from the birth date per read, never stored. */
export interface PatientListItemDto {
  id: string;
  patientName: string;
  lastActivityAt: string | null;
  sex: 'female' | 'male' | 'unspecified';
  isChild: boolean;
}

export interface RecordEntryDto {
  id: string;
  occurredAt: string | null;
  label: string | null;
}

export interface ActivityLogEntryDto extends RecordEntryDto {
  title: string | null;
  description: string | null;
  createdAt: string | null;
}

export interface ClinicalReportDto extends RecordEntryDto {
  reportType: string | null;
  url: string | null;
}

export interface CaseSummaryDto {
  id: string;
  openedAt: string | null;
  brief: string | null;
  status: string | null;
}

export interface PatientRecordDto extends PatientListItemDto {
  dateOfBirth: string | null;
  phone: string | null;
  email: string | null;
  emergencyContact: { name: string; phone: string | null } | null;
  cases: CaseSummaryDto[];
  activities: ActivityLogEntryDto[];
  medications: RecordEntryDto[];
  reports: ClinicalReportDto[];
}

export interface PatientQuery {
  page?: number;
  size?: number;
  query?: string;
  sex?: string;
  childrenOnly?: boolean;
}

/** One page of the directory, with the total the server actually matched. */
export interface PatientPage {
  rows: PatientListItemDto[];
  total: number;
}

/**
 * The clinician's own patients.
 *
 * <p>Served by <b>professionalservice</b>, not patientservice. The sibling has no `Patient` resource
 * at all — patients are `Profile` documents there — and it is professionalservice that owns the
 * relation deciding which patients this clinician has worked with. Anything reaching for
 * `patientservice/api/patients` is pointing at a path that has never existed.
 *
 * <p><b>Paged since 2026-08-22.</b> Before that the endpoint took no parameters and answered with
 * the whole caseload; `X-Total-Count` was the row count, so it agreed with the body by construction
 * and could never tell a client there was another page. It is the match count now, which is what
 * makes infinite scroll possible at all.
 */
@Injectable({ providedIn: 'root' })
export class PatientApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApplicationConfigService);

  private get resourceUrl(): string {
    return this.config.getEndpointFor('api/patients', 'professionalservice');
  }

  /**
   * One page of the directory.
   *
   * <p>Read with `observe: 'response'` for `X-Total-Count`, which is how the caller knows whether to
   * ask for more. A missing header is treated as "this is everything" rather than as zero — the
   * latter would empty a list the server had just filled.
   */
  query(request: PatientQuery = {}): Observable<HttpResponse<PatientListItemDto[]>> {
    const params: Record<string, string> = {};
    if (request.page !== undefined) {
      params['page'] = String(request.page);
    }
    if (request.size !== undefined) {
      params['size'] = String(request.size);
    }
    if (request.query) {
      params['query'] = request.query;
    }
    if (request.sex) {
      params['sex'] = request.sex;
    }
    if (request.childrenOnly) {
      params['childrenOnly'] = 'true';
    }
    return this.http.get<PatientListItemDto[]>(this.resourceUrl, { params, observe: 'response' });
  }

  /** One patient's full record. 404 for a patient outside the caller's caseload, same as absent. */
  find(id: string): Observable<PatientRecordDto> {
    return this.http.get<PatientRecordDto>(`${this.resourceUrl}/${encodeURIComponent(id)}`);
  }
}
