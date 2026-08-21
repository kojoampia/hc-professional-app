import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { NotificationsApiService } from './notifications-api.service';

describe('NotificationsApiService', () => {
  let service: NotificationsApiService;
  let httpMock: HttpTestingController;

  const BASE = 'services/professionalservice/api/notifications';

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(NotificationsApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('registers through the microservice prefix, never a bare path', () => {
    // getEndpointFor with the service name is the rule the whole app follows; a hardcoded
    // /api/notifications would reach the GATEWAY, which has no device registry at all.
    service.register({ token: 'tok-1', platform: 'ANDROID', appVersion: '0.1.0', langKey: 'de' }).subscribe();

    const request = httpMock.expectOne(r => r.method === 'POST' && r.url.endsWith(`${BASE}/devices`));
    expect(request.request.body).toEqual({ token: 'tok-1', platform: 'ANDROID', appVersion: '0.1.0', langKey: 'de' });
    request.flush({});
  });

  it('escapes the token in the deregistration path', () => {
    // FCM tokens contain ':' and '/'. Unescaped, the path silently becomes a different — and
    // usually nonexistent — resource, so the device is never removed server-side.
    service.deregister('abc:APA91b/xyz').subscribe();

    httpMock.expectOne(r => r.method === 'DELETE' && r.url.endsWith(`${BASE}/devices/abc%3AAPA91b%2Fxyz`)).flush(null);
  });

  it('reads and writes all three preferences', () => {
    service.savePreferences({ messages: false, compliance: true, showSenderName: true }).subscribe();

    const request = httpMock.expectOne(r => r.method === 'PUT' && r.url.endsWith(`${BASE}/preferences`));
    expect(request.request.body).toEqual({ messages: false, compliance: true, showSenderName: true });
    request.flush({ messages: false, compliance: true, showSenderName: true });
  });
});
