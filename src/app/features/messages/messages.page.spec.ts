import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';

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
      providers: [provideHttpClient(), provideHttpClientTesting()],
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
