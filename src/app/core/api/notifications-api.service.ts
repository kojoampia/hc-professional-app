import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApplicationConfigService } from '../config/application-config.service';

/** What the server needs to know about this handset to notify it. Carries no credential. */
export interface DeviceRegistration {
  token: string;
  /** `IOS` routes to APNs; anything else goes to FCM. Upper case, matching `DeviceToken.platform`. */
  platform: string;
  appVersion: string;
  /**
   * The language THIS device wants its notifications in.
   *
   * The server composes the tray text — Android cannot resolve a dotted `title_loc_key` as a string
   * resource and iOS never reads the keys at all, so localising on the device is not an option. It
   * is per device rather than per account on purpose: an English work handset and a German personal
   * one belong to the same clinician and should each notify in their own language.
   */
  langKey: string;
}

/** The three preferences, which live on the Profile and so follow the clinician across devices. */
export interface NotificationPreferences {
  messages: boolean;
  compliance: boolean;
  /**
   * Whether the sender's name may appear on the lock screen. Defaults to false, unlike the other
   * two: a preview is visible to whoever is holding the phone.
   */
  showSenderName: boolean;
}

/**
 * Device registrations and notification preferences (MOB10).
 *
 * <p>Everything here is under `/api/notifications/**`, which `api/`'s SecurityConfiguration declares
 * `authenticated()` **above** the `POST|PUT /api/**` rules that require `CLINICAL_MUTATION`. That
 * ordering is the whole reason these are not on an entity endpoint: a carer, angel, chemist or
 * technician — every read-only role — would otherwise get a silent 403 registering their phone and
 * simply never receive a notification, with nothing on screen to act on.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ApplicationConfigService);

  private endpoint(path: string): string {
    return this.config.getEndpointFor(`api/notifications/${path}`, 'professionalservice');
  }

  /**
   * Registers or refreshes this device.
   *
   * <p>Safe to repeat: the server upserts on the token and **reassigns the account** on conflict,
   * which is what stops clinician A's notifications reaching clinician B after a second user signs
   * in on the same handset. Re-registering also revives a token previously pruned as dead.
   */
  register(registration: DeviceRegistration): Observable<unknown> {
    return this.http.post(this.endpoint('devices'), registration);
  }

  /** Deregisters this device. Called during sign-out, while the access token is still valid. */
  deregister(token: string): Observable<void> {
    return this.http.delete<void>(this.endpoint(`devices/${encodeURIComponent(token)}`));
  }

  preferences(): Observable<NotificationPreferences> {
    return this.http.get<NotificationPreferences>(this.endpoint('preferences'));
  }

  /** Replaces all three. A partial body would be indistinguishable from "off". */
  savePreferences(preferences: NotificationPreferences): Observable<NotificationPreferences> {
    return this.http.put<NotificationPreferences>(this.endpoint('preferences'), preferences);
  }
}
