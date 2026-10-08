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
export interface ProfileAddressDto {
  streetAddress?: string;
  city?: string;
  region?: string;
  country?: string;
  town?: string;
  district?: string;
  digitalAddress?: string;
}

export interface EmergencyContactDto {
  name?: string;
  relationship?: string;
  phone?: string;
}

export interface ClinicianProfileDto {
  id?: string;
  accountId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  mobilePhone?: string;
  /**
   * The fields the completion meter counts, added in Phase 9.
   *
   * <p>These are not decoration beside the meter — they are what it measures. `OnboardingService`
   * requires first name, last name, birth date, sex, mobile phone, card type and card number for
   * `profile`; street/city/region/country for `address`; and name/relationship/phone for
   * `nextOfKin`. Showing a clinician that their address is outstanding while offering nowhere to
   * enter one is worse than not showing the meter at all.
   */
  birthDate?: string;
  sex?: string;
  phoneNumber?: string;
  cardType?: string;
  cardNumber?: string;
  address?: ProfileAddressDto;
  emergencyContact?: EmergencyContactDto;
}

/** What the server still wants before this clinician can be activated. Keys are translated. */
export type OnboardingRequirementKey = 'consent' | 'profile' | 'address' | 'nextOfKin' | 'certificate' | 'license' | 'identity' | 'photo';

/**
 * Server-computed onboarding completion.
 *
 * <p><b>Deliberately not derived on the phone.</b> The same figure gates the transition to ACTIVE,
 * so a client-side percentage can read 100% while the service still refuses to advance the
 * application. The client's job is to render this, not to reproduce it.
 *
 * <p>`complete` is not `status === 'ACTIVE'`: activation needs completeness <b>and</b> admin
 * vetting, so a finished profile nobody has reviewed is `complete: true` and well short of ACTIVE.
 */
export interface OnboardingProgressDto {
  percent: number;
  complete: boolean;
  status: string | null;
  requirements: { key: OnboardingRequirementKey; done: boolean }[];
}

/**
 * Reads and writes the signed-in clinician's profile.
 *
 * <p>Goes through `/api/profile`, which is `.authenticated()` rather than role-gated — an applicant
 * holding only `ROLE_USER` must be able to fill in their own details before any clinical authority
 * is granted. The server force-sets `accountId` to the caller on write, so a client cannot edit
 * somebody else's profile by supplying an id.
 *
 * <h2>⚠ It was `/api/onboarding/profile` until F8, and this app is why the order mattered</h2>
 *
 * <p>`profile.md` § Other Elements: *"`api/onboarding/profile` should migrate to `api/profile`"*. The
 * house rule is **add before removing, and remove the consumer before the producer**, and `mobile/`
 * is the consumer that the profile migration kept stranding: it appears in no task in
 * `profile-addendum.md`, it both reads and writes this path, and the Me tab's next-of-kin card is
 * behind it. A clean server-side break would have answered **404 on the save with nothing in any
 * backlog that would fix it** — and before that, when the field was renamed, it would have answered
 * 200 with the next of kin silently not stored, which is the failure this estate keeps relearning.
 * Re-pointed in the same unit as the server change, ahead of the retirement.
 *
 * <p>⭐ **The semantics improved and no call site had to change.** The old `PUT` was a thirteen-field
 * whole-document replace with no null guards, so `save()` was only safe because `me.page.ts` spreads
 * the loaded profile back. `PUT /api/profile` applies only the fields the body names, so a partial
 * save is now correct rather than merely conventional — the spread is kept because it is harmless,
 * not because it is the guard.
 *
 * <p>⛔ **`progress()` below is deliberately NOT re-pointed.** `/api/onboarding/progress` is T5's
 * subject and is still served; moving it here would pre-empt that task and break this app.
 */
@Injectable({ providedIn: 'root' })
export class ProfileApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApplicationConfigService);

  private get resourceUrl(): string {
    return this.config.getEndpointFor('api/profile', 'professionalservice');
  }

  mine(): Observable<ClinicianProfileDto> {
    return this.http.get<ClinicianProfileDto>(this.resourceUrl);
  }

  /** Upserts; the response is the stored document, which is what the page then shows. */
  /**
   * What the clinician still owes before activation.
   *
   * <p>A sibling of the profile rather than part of it: it is computed, it is not editable, and it
   * counts uploaded documents as well as profile fields.
   */
  progress(): Observable<OnboardingProgressDto> {
    return this.http.get<OnboardingProgressDto>(this.config.getEndpointFor('api/onboarding/progress', 'professionalservice'));
  }

  save(profile: ClinicianProfileDto): Observable<ClinicianProfileDto> {
    return this.http.put<ClinicianProfileDto>(this.resourceUrl, profile);
  }
}
