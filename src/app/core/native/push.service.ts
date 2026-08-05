import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { PushNotifications, type ActionPerformed, type PushNotificationSchema } from '@capacitor/push-notifications';

export interface PushCallbacks {
  /** FCM registration token — MOB10 posts this to `/api/notifications/devices`. */
  onToken: (token: string) => void;
  /** Foreground receipt. Must NOT show a tray notification — STOMP already has the socket. */
  onReceived: (notification: PushNotificationSchema) => void;
  /** User tapped a tray notification — deep-link to the conversation. */
  onActionPerformed: (action: ActionPerformed) => void;
}

/**
 * Push registration and listeners.
 *
 * `@capacitor/push-notifications` has **no web implementation** — every method throws
 * "not implemented" in a browser. So this wrapper hard-guards on `isNativePlatform()`
 * and reports `supported = false` on web, which keeps `ionic serve` and Playwright
 * working without stubbing at the plugin level.
 *
 * The server always sends both push and STOMP (it cannot know whether a socket is
 * live); the client dedupes. See mobile-app-plan.md § Push.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly tokenSignal = signal<string | null>(null);
  readonly token = this.tokenSignal.asReadonly();

  private readonly permissionSignal = signal<'unknown' | 'granted' | 'denied'>('unknown');
  readonly permission = this.permissionSignal.asReadonly();

  get supported(): boolean {
    return Capacitor.isNativePlatform();
  }

  /** Requests permission and registers. Returns false when unsupported or denied. */
  async register(callbacks: PushCallbacks): Promise<boolean> {
    if (!this.supported) {
      return false;
    }

    let status = await PushNotifications.checkPermissions();
    if (status.receive === 'prompt' || status.receive === 'prompt-with-rationale') {
      status = await PushNotifications.requestPermissions();
    }
    if (status.receive !== 'granted') {
      this.permissionSignal.set('denied');
      return false;
    }
    this.permissionSignal.set('granted');

    await PushNotifications.addListener('registration', token => {
      this.tokenSignal.set(token.value);
      callbacks.onToken(token.value);
    });
    await PushNotifications.addListener('registrationError', (error: unknown) => {
      console.error('[push] registration failed', error);
    });
    await PushNotifications.addListener('pushNotificationReceived', callbacks.onReceived);
    await PushNotifications.addListener('pushNotificationActionPerformed', callbacks.onActionPerformed);

    await PushNotifications.register();
    return true;
  }

  /** Clears the tray. Called on resume, once `unread-count` has been re-read. */
  async clearDelivered(): Promise<void> {
    if (this.supported) {
      await PushNotifications.removeAllDeliveredNotifications();
    }
  }

  /** Part of the logout sequence, after the token is deregistered server-side. */
  async unregister(): Promise<void> {
    if (!this.supported) {
      return;
    }
    await PushNotifications.removeAllListeners();
    await PushNotifications.unregister();
    this.tokenSignal.set(null);
  }
}
