import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';

import { NetworkService } from '../native/network.service';
import { offlineInterceptor } from './offline.interceptor';

describe('offlineInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  const connected = signal(true);

  beforeEach(() => {
    connected.set(true);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([offlineInterceptor])),
        provideHttpClientTesting(),
        { provide: NetworkService, useValue: { connected } },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('lets requests through when online', () => {
    http.get('/api/x').subscribe();
    backend.expectOne('/api/x').flush({});
  });

  it('fails a GET immediately when offline, without waiting for a timeout', done => {
    // Otherwise the request hangs for the platform connect timeout — tens of seconds
    // on a mobile stack — showing a spinner while the cache could have answered now.
    connected.set(false);
    http.get('/api/x').subscribe({
      error: (error: unknown) => {
        expect(error).toBeInstanceOf(HttpErrorResponse);
        expect((error as HttpErrorResponse).status).toBe(0);
        done();
      },
    });
    backend.expectNone('/api/x');
  });

  it('still ATTEMPTS a mutation when offline', () => {
    // MOB6 ships no offline write queue. A POST that vanished into a synthetic
    // error would look like success; it has to fail visibly so the user can retry.
    connected.set(false);
    http.post('/api/x', {}).subscribe({ error: () => undefined });
    backend.expectOne('/api/x').error(new ProgressEvent('offline'));
  });

  it.each(['PUT', 'DELETE', 'PATCH'])('still attempts %s when offline', method => {
    connected.set(false);
    http.request(method, '/api/x', { body: {} }).subscribe({ error: () => undefined });
    backend.expectOne('/api/x').error(new ProgressEvent('offline'));
  });
});
