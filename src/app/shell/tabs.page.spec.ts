import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { provideRouter } from '@angular/router';

import { TabsPage } from './tabs.page';

/**
 * The tab shell must not declare a router outlet of its own.
 *
 * <p>MOB11 added `<ion-router-outlet>` inside `<ion-tabs>`, which looks like the obvious way to say
 * "the pages go here" and is wrong: `IonTabs` already renders one internally and routes the tab
 * children into it. The extra outlet stayed empty, spanned the full viewport, and — painted last —
 * sat on top of every screen and swallowed every touch.
 *
 * <p>It defeated every check the project had. The pages rendered correctly, because they were in
 * IonTabs' real outlet. Nothing threw, nothing logged, and the unit suite passed: no spec renders
 * the tab shell over a page. Even remote debugging agreed the app was fine, because
 * `element.click()` bypasses hit-testing and opened the thread perfectly while a finger did
 * nothing. It took `document.elementsFromPoint` on a physical device to see the empty outlet
 * sitting on top.
 *
 * <p>So this asserts the one structural fact that distinguishes the broken shell from the correct
 * one, and it is worth more than its two lines suggest.
 */
describe('TabsPage', () => {
  let fixture: ComponentFixture<TabsPage>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TabsPage, TranslateModule.forRoot()],
      providers: [provideRouter([])],
    });
    fixture = TestBed.createComponent(TabsPage);
    fixture.detectChanges();
  });

  it('declares no router outlet of its own — IonTabs provides one', () => {
    // A direct child of ion-tabs is one this template declared. IonTabs' own lives deeper, inside
    // its wrapper, so it does not match and this stays specific to the mistake.
    const declared = fixture.debugElement.queryAll(By.css('ion-tabs > ion-router-outlet'));

    expect(declared.length).toBe(0);
  });

  it('renders the four tab buttons', () => {
    const tabs = fixture.debugElement.queryAll(By.css('ion-tab-button')).map(b => b.attributes['tab']);

    expect(tabs).toEqual(['today', 'messages', 'documents', 'me']);
  });
});
