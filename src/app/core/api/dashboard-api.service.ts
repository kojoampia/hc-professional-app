import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApplicationConfigService } from '../config/application-config.service';

/**
 * Patient-shaped figures for the calling clinician.
 *
 * <p><b>There are no case fields here, and that is the server's design.</b> Cases belong to
 * patientservice; professionalservice returns what it can answer on its own rather than fetching
 * every case to aggregate counts it cannot verify. The phone gets its case figures from
 * `/api/cases` instead, which is scoped and paged.
 */
export interface DashboardSummaryDto {
  patients: number;
  female: number;
  male: number;
  kids: number;
}

/**
 * The one dashboard endpoint that exists.
 *
 * <p>`web/`'s `DashboardApiService` declares four — summary, case-timeline, case-distribution and
 * case-by-patient-group. Three of them were never built, because they are entirely case-derived and
 * the browser composes them from `/api/clinical-cases` itself. This app does not: charts are cut
 * (decision 7), and an unpaginated cross-service fetch is exactly what Phase 1 existed to remove.
 */
@Injectable({ providedIn: 'root' })
export class DashboardApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApplicationConfigService);

  summary(): Observable<DashboardSummaryDto> {
    return this.http.get<DashboardSummaryDto>(this.config.getEndpointFor('api/dashboard/summary', 'professionalservice'));
  }
}
