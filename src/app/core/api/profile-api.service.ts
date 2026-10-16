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

/**
 * One next-of-kin contact as `GET /api/profile` serves it — the `EmergencyContact` entity shape,
 * where the number is `phone`. The deprecated singular `emergencyContact` alias is gone from this
 * type on purpose (T6): this app was its last consumer, and dropping it here is what lets the
 * server retire it.
 */
export interface EmergencyContactDto {
  id?: string;
  name?: string;
  relationship?: string;
  phone?: string;
  email?: string;
  address?: ProfileAddressDto;
}

/**
 * The same contact as `PUT /api/profile` must carry it — `EmergencyContactDTO`, where the number is
 * **`phoneNumber`**. See the class note on {@link ProfileApiService} for why the two shapes differ;
 * {@link toWireContact} is the translation, and an element re-sent under the read vocabulary would
 * have its number read as absent and blanked, with a 200.
 */
export interface EmergencyContactWriteDto {
  id?: string;
  name?: string;
  relationship?: string;
  phoneNumber?: string;
  email?: string;
  address?: ProfileAddressDto;
}

/**
 * A stored contact, re-spoken in the PUT vocabulary so it survives a whole-list replace.
 *
 * <p>`contacts` replaces wholesale on the server (a per-element merge has no "which element" answer
 * on a list with unordered members), so every save must send the full list back — and every element
 * of it has to be translated, not just the one the form edited.
 */
export function toWireContact(contact: EmergencyContactDto): EmergencyContactWriteDto {
  const { phone, ...rest } = contact;
  return { ...rest, phoneNumber: phone };
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
  /** The next-of-kin list, `contacts[0]` being what the Me card edits. Never defaulted to `[]`. */
  contacts?: EmergencyContactDto[];
}

/**
 * What `PUT /api/profile` accepts — `ProfileDTO`, which is **not** the shape the `GET` returns.
 *
 * <p>Two names differ from the read shape, and a field sent under the wrong one is dropped silently
 * (unknown JSON properties are ignored), which is a 200 with the edit unsaved: the document's mobile
 * is **`mobileNumber`** here for the entity's `mobilePhone`, and a contact's number is
 * **`phoneNumber`** for the entity's `phone`. The PUT is a partial write — a field the body does not
 * name is left as stored — so this type carries only what the Me page edits.
 */
export interface ClinicianProfileWriteDto {
  firstName?: string;
  lastName?: string;
  email?: string;
  /** The read shape's `mobilePhone` — see the type note. */
  mobileNumber?: string;
  birthDate?: string;
  sex?: string;
  phoneNumber?: string;
  cardType?: string;
  cardNumber?: string;
  address?: ProfileAddressDto;
  /** Replaced wholesale by the server — always the full list, every element in {@link EmergencyContactWriteDto}'s vocabulary. */
  contacts?: EmergencyContactWriteDto[];
}

/**
 * What the server still wants before this clinician can be activated. Keys are translated.
 *
 * <p>A <b>runtime array with the union derived from it</b> rather than a bare union, for the reason
 * `DUTY_ROSTER_SHIFTS` is one: a union cannot be enumerated at run time, so nothing can be asserted
 * against it. `web/`'s `ONBOARDING_REQUIREMENT_KEYS` is the same shape and the same nine values.
 *
 * <h3>⚠ This was a bare union of EIGHT while the ninth key was already live</h3>
 *
 * <p>`authority` — the clinical role the applicant asked for — is counted by the server's submit and
 * activation gate and has been reported by `GET /api/onboarding/progress` since `backlog.md` row 230
 * unit A. The meter renders every key the server sends by translation and unit A put `authority` into
 * all four catalogues, so it rendered correctly the whole time: <b>only the type was short.</b> That
 * is what a bare union buys — nothing fails, nothing can be enumerated, and so nothing notices.
 * Measured on the rolled quality stack as `nurse`: nine requirements, `authority` satisfied.
 */
export const ONBOARDING_REQUIREMENT_KEYS = [
  'consent',
  'profile',
  'address',
  'nextOfKin',
  'certificate',
  'license',
  'identity',
  'photo',
  'authority',
] as const;

export type OnboardingRequirementKey = (typeof ONBOARDING_REQUIREMENT_KEYS)[number];

/**
 * `profile.md`'s four coarse onboarding steps, in its order, derived the same way as the requirement
 * keys so that the meter can walk them and a label can be asserted for each.
 *
 * <p>⚠ <b>The names are the server's.</b> `web/` maps them onto its own profile tab ids — step 4 is
 * `consent` on the wire and `application` in that UI — but this app has no such tabs and so needs no
 * mapping: the Me tab renders the steps as a read-only row and the clinician fills the gaps in the
 * form below it.
 */
export const ONBOARDING_STEP_KEYS = ['account', 'profile', 'documents', 'consent'] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEP_KEYS)[number];

/**
 * One boolean per step.
 *
 * <p>⚠ <b>`account` reads `false` for every seeded clinician and that is correct, not a bug.</b> It
 * is the one step `api/` cannot compute — `firstName`, `lastName`, `langKey` and `imageUrl` live on
 * `User` in the gateway — so it comes from a stored projection fed by Kafka frames, where `false`
 * also means "no frame has arrived yet". Three independent reasons make it `false` today: no backfill
 * for accounts not written since unit A shipped, `InitialSetupMigration` bypassing the publish funnel,
 * and `imageUrl` being writable by no surface in the estate until `backlog.md` row 232 builds the
 * avatar upload. ⛔ <b>Do not build anything here that compensates for it</b> — nothing gates on it,
 * `percent` and `complete` exclude it, and its failure direction is the safe one: it can read `false`
 * when complete, never `true` when not. See `backlog.md` rows 232, 233 and 234.
 */
export type OnboardingSteps = Record<OnboardingStepKey, boolean>;

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
  /**
   * The four coarse steps, added to this contract by `backlog.md` row 230 unit A and consumed here
   * by unit C.
   *
   * <p>Two readings of one state, and both render: {@link requirements} is the fine-grained list and
   * `steps` is the coarse one. The server derives three of the four from the same requirement
   * answers (`OnboardingService.stepsFrom`) rather than evaluating the predicates twice, so the two
   * rows on screen cannot disagree about a predicate.
   *
   * <p>⚠ <b>Optional here, where `web/` declares it required</b> — and the difference is the
   * deployment model rather than a difference about the contract. `web/` ships from the same
   * `deploy/` roll as the service it talks to, so a build that knows about `steps` can only ever
   * meet a server that sends it. This app ships through an app store: a binary stays on a phone for
   * months and may well reach a gateway that predates unit A. `{@link CompletionMeterComponent}`
   * therefore reads every step through this type's absence rather than assuming the object is there.
   */
  steps?: OnboardingSteps;
}

/**
 * Reads and writes the signed-in clinician's profile.
 *
 * <p>Goes through `/api/profile`, which is `.authenticated()` rather than role-gated — an applicant
 * holding only `ROLE_USER` must be able to fill in their own details before any clinical authority
 * is granted. The server force-sets `accountId` to the caller on write, so a client cannot edit
 * somebody else's profile by supplying an id.
 *
 * <h2>⚠ It was the onboarding-scoped profile path until F8, and this app is why the order mattered</h2>
 *
 * <p>`profile.md` § Other Elements says the old profile route under the onboarding prefix *"should
 * migrate to `api/profile`"*. The house rule is **add before removing, and remove the consumer before
 * the producer**, and `mobile/` is the consumer that the profile migration kept stranding: it appears
 * in no task in `profile-addendum.md`, it both reads and writes this path, and the Me tab's
 * next-of-kin card is behind it. A clean server-side break would have answered **404 on the save with
 * nothing in any backlog that would fix it** — and before that, when the field was renamed, it would
 * have answered 200 with the next of kin silently not stored, which is the failure this estate keeps
 * relearning. Re-pointed in the same unit as the server change, ahead of the retirement.
 *
 * <p>⭐ **The `PUT` is a partial write** — it applies only the fields the body names — so a partial
 * save is correct rather than merely conventional, and absent fields survive as stored.
 *
 * <h2>⚠ The GET and the PUT speak two vocabularies, and T6 is where this app started honouring it</h2>
 *
 * <p>The `GET` (and the `PUT`'s *response*) serialize the `Profile` **entity**: `mobilePhone`, and
 * `contacts[].phone`. The `PUT`'s *request* binds **`ProfileDTO`**: `mobileNumber`, and
 * `contacts[].phoneNumber`. Unknown properties are dropped without an error, so a body written in
 * the read vocabulary answers 200 with those fields unsaved — which is exactly how the deprecated
 * singular `emergencyContact` alias and a `mobilePhone` key died on this endpoint once the server
 * froze the `ProfileDTO` write path. {@link ClinicianProfileDto} is the read shape,
 * {@link ClinicianProfileWriteDto} the write shape, and {@link toWireContact} the per-contact
 * translation; do not send one where the other is bound.
 *
 * <h2>⭐ `progress()` stays on `/api/onboarding/**`, and there is nothing left to re-point</h2>
 *
 * <p>This said `progress()` was *"deliberately NOT re-pointed"* because `/api/onboarding/progress`
 * was **T5's subject** and moving it would pre-empt that task. ⛔ **That is no longer true in either
 * half.** `backlog.md` row 230 supersedes T5 as written — T5 wanted the eight requirements collapsed
 * onto `profile.md`'s four steps, and row 230 decided instead that the wire carries *both*, coarse
 * steps beside the requirement list — and row 230's units A and B each deliberately **left the path
 * exactly where it is**. The acknowledgement endpoints stay under `/api/onboarding/**` for the same
 * decision (`profile-addendum.md` § 5 Q13, recommended *not* to absorb).
 *
 * <p>⚠ **So the comment was telling a reader to expect a migration that is not coming**, which is
 * worse than saying nothing: it marks a correct path as temporary, and the next person to tidy up
 * moves it. The path is settled; `/api/profile` is the profile document and `/api/onboarding/progress`
 * is the computed figure about an application, and they are different resources.
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

  /**
   * What the clinician still owes before activation.
   *
   * <p>A sibling of the profile rather than part of it: it is computed, it is not editable, and it
   * counts uploaded documents as well as profile fields.
   */
  progress(): Observable<OnboardingProgressDto> {
    return this.http.get<OnboardingProgressDto>(this.config.getEndpointFor('api/onboarding/progress', 'professionalservice'));
  }

  /** Partial write in the `ProfileDTO` vocabulary; the response is the stored entity, read-shaped. */
  save(profile: ClinicianProfileWriteDto): Observable<ClinicianProfileDto> {
    return this.http.put<ClinicianProfileDto>(this.resourceUrl, profile);
  }
}
