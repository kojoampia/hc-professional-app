import { Injectable, computed, inject } from '@angular/core';

import {
  DutyRosterApiService,
  DutyRosterAssignmentDto,
  ShiftLabel,
  computeShiftLabel,
  isoDate,
  selectShift,
} from '../../core/api/duty-roster-api.service';
import { MessagingApiService } from '../../core/api/messaging-api.service';
import { OnboardingApiService, OnboardingApplicationDto, PersonalDocumentDto } from '../../core/api/onboarding-api.service';
import { CacheStore } from '../../core/offline/cache-store.service';
import { CachedResource, cachedResource } from '../../core/offline/cached-resource';

/** Soft TTLs. Advisory only — they decide what the UI *says*, never whether cache is served. */
const ROSTER_TTL_MS = 12 * 60 * 60 * 1000;
const DOCUMENTS_TTL_MS = 24 * 60 * 60 * 1000;
const UNREAD_TTL_MS = 5 * 60 * 1000;
const APPLICATION_TTL_MS = 24 * 60 * 60 * 1000;

/** A licence within this many days of expiry earns a place on the Today strip. */
const EXPIRY_WARNING_DAYS = 30;

export interface ExpiringDocument {
  document: PersonalDocumentDto;
  daysRemaining: number;
  lapsed: boolean;
}

/**
 * Everything the Today screen shows.
 *
 * Each source is an independent {@link CachedResource}, so a failure in one does not
 * blank the others — losing the unread count must not take the roster down with it.
 */
@Injectable({ providedIn: 'root' })
export class TodayStore {
  private readonly cache = inject(CacheStore);
  private readonly rosterApi = inject(DutyRosterApiService);
  private readonly messagingApi = inject(MessagingApiService);
  private readonly onboardingApi = inject(OnboardingApiService);

  readonly roster: CachedResource<DutyRosterAssignmentDto[]> = cachedResource(this.cache, {
    key: 'roster.my',
    ttlMs: ROSTER_TTL_MS,
    fetch: () => this.rosterApi.myAssignments(),
  });

  readonly unread: CachedResource<number> = cachedResource(this.cache, {
    key: 'messaging.unreadCount',
    ttlMs: UNREAD_TTL_MS,
    fetch: () => this.messagingApi.unreadCount(),
  });

  readonly documents: CachedResource<PersonalDocumentDto[]> = cachedResource(this.cache, {
    key: 'onboarding.myDocuments',
    ttlMs: DOCUMENTS_TTL_MS,
    fetch: () => this.onboardingApi.myDocuments(),
  });

  readonly application: CachedResource<OnboardingApplicationDto> = cachedResource(this.cache, {
    key: 'onboarding.myApplication',
    ttlMs: APPLICATION_TTL_MS,
    fetch: () => this.onboardingApi.myApplication(),
  });

  /** Assignments sorted by date, today onwards, for the next-7-days list. */
  readonly upcoming = computed<DutyRosterAssignmentDto[]>(() => {
    const today = isoDate(new Date());
    const horizon = isoDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    return [...(this.roster.value() ?? [])]
      .filter(assignment => assignment.date >= today && assignment.date <= horizon)
      .sort((a, b) => (a.date === b.date ? a.shift.localeCompare(b.shift) : a.date < b.date ? -1 : 1));
  });

  /** "On duty until 14:00" / "Next shift ...". Null when nothing is assigned. */
  readonly shiftLabel = computed<ShiftLabel | null>(() => computeShiftLabel(this.roster.value() ?? [], new Date()));

  /**
   * The assignment the headline is about — the same one, so the card body cannot
   * describe a different shift from its own heading.
   */
  readonly featuredAssignment = computed<DutyRosterAssignmentDto | null>(
    () => selectShift(this.roster.value() ?? [], new Date())?.assignment ?? null,
  );

  /**
   * Licences lapsed or within 30 days of it.
   *
   * Only LICENSE documents: `ComplianceService` restricts an ACTIVE application when
   * a licence expires, so that is the one that costs the clinician their access. A
   * certificate expiring is not the same event.
   */
  readonly expiringDocuments = computed<ExpiringDocument[]>(() => {
    const now = Date.now();
    return (this.documents.value() ?? [])
      .filter(doc => doc.type === 'LICENSE' && doc.expiryDate)
      .map(doc => {
        const daysRemaining = Math.floor((new Date(`${doc.expiryDate as string}T12:00:00`).getTime() - now) / 86_400_000);
        return { document: doc, daysRemaining, lapsed: daysRemaining < 0 };
      })
      .filter(entry => entry.daysRemaining <= EXPIRY_WARNING_DAYS)
      .sort((a, b) => a.daysRemaining - b.daysRemaining);
  });

  /** The oldest fetch across the sources — what the staleness chip reports. */
  readonly oldestFetchedAt = computed<number | null>(() => {
    const stamps = [this.roster.fetchedAt(), this.unread.fetchedAt(), this.documents.fetchedAt()].filter(
      (value): value is number => value !== null,
    );
    return stamps.length ? Math.min(...stamps) : null;
  });

  readonly isStale = computed(
    () => this.roster.status() === 'stale' || this.unread.status() === 'stale' || this.documents.status() === 'stale',
  );

  /** Refreshes everything. Independent, so one failure cannot cascade. */
  async refresh(): Promise<void> {
    await Promise.all([this.roster.refresh(), this.unread.refresh(), this.documents.refresh(), this.application.refresh()]);
  }
}
