import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateLoader, TranslateModule, TranslateService } from '@ngx-translate/core';
import { signal } from '@angular/core';

import { BundledTranslateLoader } from '../core/i18n/language.service';
import { NetworkService } from '../core/native/network.service';
import { AsyncBannerComponent } from './async-banner.component';
import { EmptyRowComponent } from './empty-row.component';
import { PendingChipComponent } from './pending-chip.component';
import { StatTileComponent } from './stat-tile.component';

/**
 * The three shared components.
 *
 * <p>They exist because the wording decision behind each was being made once per screen, so these
 * assert the decision rather than the markup: which of offline/stale/error wins, which of "nothing
 * here" and "could not load" a row shows, and what an unsent entry says. Rendered against the real
 * catalogues, because a component whose whole job is choosing a translation key should be proven to
 * choose one that exists.
 */
describe('shared components', () => {
  const connected = signal(true);

  const configure = (): void => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot({ defaultLanguage: 'en', loader: { provide: TranslateLoader, useClass: BundledTranslateLoader } })],
      providers: [{ provide: NetworkService, useValue: { connected } }],
    });
  };

  beforeEach(() => {
    connected.set(true);
    configure();
    // Without an active language ngx-translate renders the key itself — which is the failure these
    // components exist to avoid, so a spec that hit it would be asserting nothing.
    TestBed.inject(TranslateService).use('en');
  });

  describe('hpd-async-banner', () => {
    const render = (status: string, fetchedAt: number | null = Date.now()): ComponentFixture<AsyncBannerComponent> => {
      const fixture = TestBed.createComponent(AsyncBannerComponent);
      fixture.componentRef.setInput('status', status);
      fixture.componentRef.setInput('fetchedAt', fetchedAt);
      fixture.detectChanges();
      return fixture;
    };

    it('says nothing when the data is fresh and the phone is online', () => {
      expect(render('fresh').nativeElement.textContent.trim()).toBe('');
    });

    it('says the data is saved when it is stale', () => {
      expect(render('stale').nativeElement.textContent).toContain('Showing saved data');
    });

    it('OFFLINE WINS over stale', () => {
      // A clinician who has lost signal needs that first; the data being old is the consequence
      // rather than the news.
      connected.set(false);
      expect(render('stale').nativeElement.textContent).toContain('Offline');
    });

    it('speaks up when offline even if the data is fresh', () => {
      connected.set(false);
      expect(render('fresh').nativeElement.textContent).toContain('Offline');
    });

    it('does NOT report an error — that is the empty row s job', () => {
      // error means there is nothing cached at all, which a banner over an empty list would
      // duplicate confusingly.
      expect(render('error').nativeElement.textContent.trim()).toBe('');
    });

    it('renders the age, not a raw timestamp', () => {
      expect(render('stale', Date.now()).nativeElement.textContent).toContain('just now');
    });
  });

  describe('hpd-empty-row', () => {
    const render = (status: string): ComponentFixture<EmptyRowComponent> => {
      const fixture = TestBed.createComponent(EmptyRowComponent);
      fixture.componentRef.setInput('status', status);
      fixture.componentRef.setInput('emptyKey', 'today.nothingRostered');
      fixture.componentRef.setInput('failedKey', 'today.rosterFailed');
      fixture.detectChanges();
      return fixture;
    };

    it('says "nothing here" when there is simply nothing', () => {
      expect(render('fresh').nativeElement.textContent).toContain('Nothing rostered');
    });

    it('says "could not load" only on an error', () => {
      // These two look identical in the DOM and mean opposite things. Getting the branch backwards
      // tells a clinician their roster is empty when the phone simply could not read it.
      expect(render('error').nativeElement.textContent).toContain('Could not load');
    });

    it('does NOT claim a failure merely because the data is stale', () => {
      // Stale data is still shown; a stale list that is empty is empty as far as anyone knows.
      expect(render('stale').nativeElement.textContent).toContain('Nothing rostered');
    });
  });

  describe('hpd-pending-chip', () => {
    const render = (state: string): ComponentFixture<PendingChipComponent> => {
      const fixture = TestBed.createComponent(PendingChipComponent);
      fixture.componentRef.setInput('state', state);
      fixture.detectChanges();
      return fixture;
    };

    it('marks a queued entry as unsent', () => {
      expect(render('pending').nativeElement.textContent).toContain('Not sent yet');
    });

    it('distinguishes a conflict from a refusal, because they need different actions', () => {
      expect(render('conflict').nativeElement.textContent).toContain('Changed elsewhere');
      expect(render('rejected').nativeElement.textContent).toContain('Refused');
    });

    it('colours anything needing attention as danger, and a waiting entry as warning', () => {
      expect(render('pending').componentInstance.colour()).toBe('warning');
      expect(render('conflict').componentInstance.colour()).toBe('danger');
      expect(render('expired').componentInstance.colour()).toBe('danger');
    });
  });

  describe('hpd-stat-tile', () => {
    const render = (value: number | null): ComponentFixture<StatTileComponent> => {
      const fixture = TestBed.createComponent(StatTileComponent);
      fixture.componentRef.setInput('labelKey', 'patients.title');
      fixture.componentRef.setInput('value', value);
      fixture.detectChanges();
      return fixture;
    };

    it('shows the number', () => {
      expect(render(7).nativeElement.textContent).toContain('7');
    });

    it('shows a REAL zero, because none is a fact worth stating', () => {
      expect(render(0).nativeElement.textContent).toContain('0');
    });

    it('shows a dash for an UNKNOWN value, never a zero', () => {
      // "0 urgent" is a clinical claim. A tile that makes it because a request failed is worse
      // than one that admits it does not know — the server takes the same position.
      const text = render(null).nativeElement.textContent;
      expect(text).toContain('—');
      expect(text).not.toContain('0');
    });
  });

  describe('every key these components can choose actually exists', () => {
    it('renders no bare translation keys in any state', () => {
      // The failure mode ngx-translate has: a missing key renders as the key itself, mid-screen,
      // with nothing thrown and nothing logged.
      const states = ['fresh', 'stale', 'error'];
      for (const status of states) {
        const banner = TestBed.createComponent(AsyncBannerComponent);
        banner.componentRef.setInput('status', status);
        banner.componentRef.setInput('fetchedAt', Date.now());
        banner.detectChanges();
        expect(banner.nativeElement.textContent).not.toMatch(/\b(today|common)\.[a-zA-Z]+/);
      }
      for (const state of ['pending', 'conflict', 'rejected', 'expired']) {
        const chip = TestBed.createComponent(PendingChipComponent);
        chip.componentRef.setInput('state', state);
        chip.detectChanges();
        expect(chip.nativeElement.textContent).not.toMatch(/\bcommon\.[a-zA-Z]+/);
      }
    });
  });
});
