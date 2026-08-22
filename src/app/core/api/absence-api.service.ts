import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApplicationConfigService } from '../config/application-config.service';

export type AbsenceType = 'HOLIDAY' | 'SICK' | 'OTHER';

/**
 * Mirrors `api/domain/enumeration/AbsenceStatus`.
 *
 * <p>Two values, and there is deliberately no `REJECTED`: an administrator declining a request
 * deletes it, and so does a clinician withdrawing their own. A third state would have to be
 * displayed somewhere and would mean the same thing as the row being gone.
 */
export type AbsenceStatus = 'REQUESTED' | 'APPROVED';

export interface AbsenceDto {
  id?: string;
  professionalId?: string;
  /** ISO date, inclusive. */
  fromDate: string;
  /** ISO date, inclusive — equal to `fromDate` for a single day off. */
  toDate: string;
  type: AbsenceType;
  status: AbsenceStatus;
}

/**
 * The clinician's own time off.
 *
 * <p>Copied from `web/src/main/webapp/app/health-connect/api/absence-api.service.ts`, minus every
 * administrator route. `GET /all` and `PUT /{id}/approve` are `ROLE_ADMIN` and are **not ported** —
 * approving leave is a back-office decision, and this app is a clinician's.
 *
 * <p><b>These are the only writes a clinician has on the roster.</b> Rounds and visits are assigned
 * by administrators; asking for leave and withdrawing that request are the two things a clinician
 * may do to their own schedule.
 *
 * <p>`/api/absences/**` is hoisted above the `CLINICAL_MUTATION` rules in the server's
 * SecurityConfiguration precisely so that carer, angel, chemist and technician — read-only in v1 —
 * can still ask for time off. Booking leave is not a clinical mutation.
 */
@Injectable({ providedIn: 'root' })
export class AbsenceApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApplicationConfigService);

  private get resourceUrl(): string {
    return this.config.getEndpointFor('api/absences', 'professionalservice');
  }

  /**
   * The caller's own absences, optionally bounded by date.
   *
   * <p>The server resolves the professional from the token. There is no way to ask for someone
   * else's from this client, and the `professionalId` parameter the web service passes for
   * administrators is deliberately absent.
   */
  mine(from?: string, to?: string): Observable<AbsenceDto[]> {
    const params: Record<string, string> = {};
    if (from) {
      params['from'] = from;
    }
    if (to) {
      params['to'] = to;
    }
    return this.http.get<AbsenceDto[]>(this.resourceUrl, { params });
  }

  /**
   * Requests leave. The server sets `professionalId` and `status: REQUESTED` from the token.
   *
   * <p>Sending either would be ignored; they are omitted rather than sent-and-ignored so the body
   * says only what the clinician actually chose.
   */
  request(absence: { fromDate: string; toDate: string; type: AbsenceType }): Observable<AbsenceDto> {
    return this.http.post<AbsenceDto>(this.resourceUrl, absence);
  }

  /**
   * Withdraws a request, or gives back approved leave.
   *
   * <p>Same verb for both because the server treats them the same way: the row goes. An approved
   * absence that is withdrawn frees the day, which is why this is not restricted to REQUESTED.
   */
  withdraw(id: string): Observable<void> {
    return this.http.delete<void>(`${this.resourceUrl}/${encodeURIComponent(id)}`);
  }
}
