import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NavController } from '@ionic/angular/standalone';

import { LanguageService } from '../i18n/language.service';
import { MessagesStore } from '../../features/messages/messages.store';
import { PlatformService } from '../native/platform.service';
import { PushService } from '../native/push.service';
import { PushRegistrationService } from './push-registration.service';

interface Callbacks {
  onToken: (token: string) => void;
  onReceived: (notification: { data?: Record<string, string> }) => void;
  onActionPerformed: (action: { notification: { data?: Record<string, string> } }) => void;
}

describe('PushRegistrationService', () => {
  let service: PushRegistrationService;
  let httpMock: HttpTestingController;
  let callbacks: Callbacks;

  const token = signal<string | null>(null);
  const language = signal<'en' | 'de'>('en');
  let push: { register: jest.Mock; token: typeof token };
  let messages: { onNotification: jest.Mock };
  let nav: { navigateRoot: jest.Mock };

  const DEVICES_URL = 'services/professionalservice/api/notifications/devices';

  beforeEach(() => {
    token.set(null);
    language.set('en');

    push = {
      token,
      register: jest.fn(async (cb: Callbacks) => {
        callbacks = cb;
        return true;
      }),
    };
    messages = { onNotification: jest.fn().mockResolvedValue(true) };
    nav = { navigateRoot: jest.fn().mockResolvedValue(true) };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PushService, useValue: push },
        { provide: MessagesStore, useValue: messages },
        { provide: NavController, useValue: nav },
        { provide: LanguageService, useValue: { current: language } },
        { provide: PlatformService, useValue: { name: () => 'android' } },
      ],
    });

    service = TestBed.inject(PushRegistrationService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  /** Drives the plugin's registration callback, which is what a real device does on launch. */
  const receiveToken = (value = 'tok-1'): void => {
    token.set(value);
    callbacks.onToken(value);
  };

  it('posts the token the plugin hands it, with the platform in upper case', async () => {
    await service.start();
    receiveToken();

    const request = httpMock.expectOne(r => r.method === 'POST' && r.url.endsWith(DEVICES_URL));
    // Capacitor answers 'android'; the server matches 'IOS' exactly to choose APNs.
    expect(request.request.body).toMatchObject({ token: 'tok-1', platform: 'ANDROID', langKey: 'en' });
    request.flush({});
  });

  it('sends the language, because the tray text is composed by the server', async () => {
    language.set('de');
    await service.start();
    receiveToken();

    const request = httpMock.expectOne(r => r.method === 'POST' && r.url.endsWith(DEVICES_URL));
    expect(request.request.body.langKey).toBe('de');
    request.flush({});
  });

  it('re-registers when the clinician changes language', async () => {
    await service.start();
    receiveToken();
    httpMock.expectOne(r => r.url.endsWith(DEVICES_URL)).flush({});
    await Promise.resolve();

    language.set('de');
    TestBed.flushEffects();

    // Without this the notifications stay English forever while every screen is German — nothing
    // looks wrong, so nobody reports it.
    const request = httpMock.expectOne(r => r.method === 'POST' && r.url.endsWith(DEVICES_URL));
    expect(request.request.body.langKey).toBe('de');
    request.flush({});
  });

  it('does not re-register on a language change before there is a token', () => {
    language.set('de');
    TestBed.flushEffects();

    httpMock.expectNone(r => r.url.endsWith(DEVICES_URL));
  });

  it('a foreground receipt refreshes the badge and shows nothing', async () => {
    await service.start();
    receiveToken();
    httpMock.expectOne(r => r.url.endsWith(DEVICES_URL)).flush({});

    callbacks.onReceived({ data: { messageId: 'm1', conversationId: 'c1' } });
    await Promise.resolve();

    // The store's LRU is what stops the push and the STOMP frame for the same message counting
    // twice; raising a tray row here would double a notification the user is already looking at.
    expect(messages.onNotification).toHaveBeenCalledWith('m1');
    expect(nav.navigateRoot).not.toHaveBeenCalled();
  });

  it('a tap opens the conversation it names', async () => {
    await service.start();
    receiveToken();
    httpMock.expectOne(r => r.url.endsWith(DEVICES_URL)).flush({});

    callbacks.onActionPerformed({ notification: { data: { messageId: 'm1', conversationId: 'c9' } } });
    await Promise.resolve();

    expect(nav.navigateRoot).toHaveBeenCalledWith(['/messages'], { queryParams: { conversation: 'c9' } });
  });

  it('a tap on a compliance alert opens Documents rather than nothing', async () => {
    await service.start();
    receiveToken();
    httpMock.expectOne(r => r.url.endsWith(DEVICES_URL)).flush({});

    callbacks.onActionPerformed({ notification: { data: { type: 'compliance.alert', entityId: 'd1' } } });
    await Promise.resolve();

    expect(nav.navigateRoot).toHaveBeenCalledWith(['/documents']);
  });

  it('is idempotent — a remount does not ask for permission again', async () => {
    await service.start();
    await service.start();

    // On iOS the permission prompt is a one-shot: asking again after a decline does nothing, and
    // asking repeatedly is how an app trains a user to decline.
    expect(push.register).toHaveBeenCalledTimes(1);
  });

  it('re-arms after sign-out clears the token', async () => {
    await service.start();
    receiveToken();
    httpMock.expectOne(r => r.url.endsWith(DEVICES_URL)).flush({});

    await Promise.resolve();

    // AuthService.endSession deregisters server-side and then PushService.unregister() nulls this.
    token.set(null);

    await service.start();
    expect(push.register).toHaveBeenCalledTimes(2);
  });

  it('a failed registration is swallowed', async () => {
    await service.start();
    receiveToken();

    httpMock.expectOne(r => r.url.endsWith(DEVICES_URL)).flush('nope', { status: 503, statusText: 'Service Unavailable' });
    await Promise.resolve();

    // The token is reissued on every launch, so a failure costs one session's notifications and
    // nothing more — an error dialog would put something in front of a clinician they cannot act
    // on. But nothing is recorded as registered either, so a later language change does not fire a
    // pointless update for a device the server never heard about.
    language.set('de');
    TestBed.flushEffects();
    httpMock.expectNone(r => r.url.endsWith(DEVICES_URL));
  });
});
