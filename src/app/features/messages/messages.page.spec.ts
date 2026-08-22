import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { provideRouter } from '@angular/router';

import { MessagesPage } from './messages.page';

// jsdom has no IndexedDB, and the store caches thread bodies through idb-keyval. Same in-memory
// stand-in the store spec uses; the cache is not what these assert.
const disk = new Map<string, unknown>();
jest.mock('idb-keyval', () => ({
  get: jest.fn(async (key: string) => disk.get(key)),
  set: jest.fn(async (key: string, value: unknown) => void disk.set(key, value)),
  del: jest.fn(async (key: string) => void disk.delete(key)),
  keys: jest.fn(async () => [...disk.keys()]),
  clear: jest.fn(async () => disk.clear()),
}));
import { MessagesStore } from './messages.store';

/**
 * Opening a thread — reported broken on a real device, where tapping a conversation did nothing.
 *
 * <p>These assert the wiring rather than the rendering: that a tap reaches the store, that the
 * store records which thread is open, and that the modal is therefore told to present. If they pass
 * while the device still fails, the fault is presentation — which is the more likely half, and
 * narrowing it is the point of having them.
 */
describe('MessagesPage — opening a thread', () => {
  let fixture: ComponentFixture<MessagesPage>;
  let page: MessagesPage;
  let store: MessagesStore;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [MessagesPage, TranslateModule.forRoot()],
      // provideRouter supplies the ActivatedRoute the page reads a tapped notification's
      // conversation id from (MOB10).
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    fixture = TestBed.createComponent(MessagesPage);
    page = fixture.componentInstance;
    store = TestBed.inject(MessagesStore);
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('records the open thread immediately, without waiting on the fetch', () => {
    expect(store.openConversationId()).toBeNull();

    // Deliberately NOT awaited. openThread sets the signal synchronously and only then fetches, so
    // the modal must present at once — a thread that appeared only after the network answered
    // would look like a dead tap on a slow connection, which is what was reported.
    void page.open('conversation-1');

    expect(store.openConversationId()).toBe('conversation-1');
  });

  it('binds the modal to that state, so opening a thread presents it', () => {
    fixture.detectChanges();
    const modalBefore = fixture.debugElement.query(By.css('ion-modal'));
    expect(modalBefore.componentInstance?.isOpen ?? modalBefore.attributes['ng-reflect-is-open']).toBeFalsy();

    void page.open('conversation-1');
    fixture.detectChanges();

    const modal = fixture.debugElement.query(By.css('ion-modal'));
    expect(modal).toBeTruthy();
    // Read through the DOM rather than the component field: the question is what the template
    // actually passed down, which is where a broken binding would show.
    expect(modal.componentInstance?.isOpen ?? modal.attributes['ng-reflect-is-open']).toBeTruthy();
  });

  it('clears the open thread on close', () => {
    void page.open('conversation-1');
    page.close();

    expect(store.openConversationId()).toBeNull();
  });

  afterEach(() => {
    // The store fetches the thread and marks it read; neither is what these assert.
    httpMock.match(() => true).forEach(request => request.flush([]));
    httpMock.verify();
  });
});

/**
 * Composing a new conversation, and the confirmation that stands between a clinician and a
 * broadcast they cannot see the audience of.
 *
 * <p>These use `HttpTestingController` rather than a stubbed store, because the URLs are new and
 * the URL is exactly what Phase 0 exists to catch: the one service without an HTTP spec had the
 * wrong path, and every store spec that stubbed it was green.
 */
describe('MessagesPage — composing', () => {
  let fixture: ComponentFixture<MessagesPage>;
  let page: MessagesPage;
  let httpMock: HttpTestingController;

  const recipientsUrl = (url: string): boolean => url.endsWith('/api/messaging/recipients');

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MessagesPage, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    fixture = TestBed.createComponent(MessagesPage);
    page = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    page.openCompose();
  });

  it('does not search on one letter — the directory is not a prefix scan', async () => {
    await page.searchRecipients('a');

    httpMock.expectNone(request => recipientsUrl(request.url));
    expect(page.matches()).toEqual([]);
  });

  it('reads the role-scoped directory, NOT the gateway user list', async () => {
    const search = page.searchRecipients('ama');
    const request = httpMock.expectOne(req => recipientsUrl(req.url));

    // The gateway's /api/users returns every gateway user unfiltered, including accounts that are
    // not clinicians. This asserts which endpoint was chosen, which is the whole point.
    expect(request.request.url).toContain('professionalservice');
    expect(request.request.params.get('query')).toBe('ama');
    request.flush([{ accountId: 'u1', displayName: 'Ama Mensah', role: 'ROLE_NURSE' }]);
    await search;

    expect(page.matches()).toHaveLength(1);
  });

  it('refuses to send with no body and no recipient, before touching the network', async () => {
    await page.submitCompose();

    expect(page.composeError()).toBe('messages.composeNeedsBody');
    httpMock.expectNone(() => true);
  });

  it('refuses to send a body with nobody to send it to', async () => {
    page.composeBody = 'Please review';

    await page.submitCompose();

    expect(page.composeError()).toBe('messages.composeNeedsRecipient');
    httpMock.expectNone(() => true);
  });

  it('CONFIRMS a broadcast with the count before sending anything', async () => {
    // A clinician cannot see who a role broadcast reaches. Being told "14 people" beforehand is
    // the only thing standing between an escalation and an audience they did not intend.
    page.composeBody = 'All hands';
    page.composeRole = 'ROLE_NURSE';

    const submit = page.submitCompose();
    httpMock
      .expectOne(req => recipientsUrl(req.url))
      .flush([
        { accountId: 'u1', displayName: 'A', role: 'ROLE_NURSE' },
        { accountId: 'u2', displayName: 'B', role: 'ROLE_NURSE' },
      ]);
    await submit;

    expect(page.confirmingBroadcast()).toBe(true);
    expect(page.broadcastCount()).toBe(2);
    // Nothing has been sent — the confirmation is a gate, not a notification.
    httpMock.expectNone(req => req.method === 'POST');
  });

  it('stops a broadcast to a role nobody holds, and says why', async () => {
    // The server answers 422 for this. Saying so here spares a send that cannot work, and this is
    // a real case: a typo, or a role whose last holder was deactivated.
    page.composeBody = 'All hands';
    page.composeRole = 'ROLE_CHEMIST';

    const submit = page.submitCompose();
    httpMock.expectOne(req => recipientsUrl(req.url)).flush([]);
    await submit;

    expect(page.composeError()).toBe('messages.composeRoleEmpty');
    expect(page.confirmingBroadcast()).toBe(false);
  });

  it('switching to a role clears the people already chosen', async () => {
    // A message goes to people or to a role. Carrying a stale selection across would send to an
    // audience the clinician stopped choosing.
    const search = page.searchRecipients('ama');
    httpMock.expectOne(req => recipientsUrl(req.url)).flush([{ accountId: 'u1', displayName: 'Ama', role: 'ROLE_NURSE' }]);
    await search;
    page.toggleRecipient(page.matches()[0]);
    expect(page.chosen()).toHaveLength(1);

    page.switchMode('role');

    expect(page.chosen()).toEqual([]);
    expect(page.composeRole).toBe('ROLE_DOCTOR');
  });

  afterEach(() => {
    httpMock.match(() => true).forEach(request => request.flush([]));
  });
});
