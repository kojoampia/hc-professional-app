import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { TranslateLoader, TranslateModule, TranslateService } from '@ngx-translate/core';

import { BundledTranslateLoader } from '../../core/i18n/language.service';
import { PersonalDocumentDto } from '../../core/api/onboarding-api.service';
import { DocumentsPage } from './documents.page';
import { DocumentsStore } from './documents.store';

// The store caches through idb-keyval, which jsdom has no indexedDB for. Stubbed exactly as
// documents.store.spec.ts does — this file asserts what the list draws, not where it is kept.
const disk = new Map<string, unknown>();
jest.mock('idb-keyval', () => ({
  get: jest.fn(async (key: string) => disk.get(key)),
  set: jest.fn(async (key: string, value: unknown) => void disk.set(key, value)),
  del: jest.fn(async (key: string) => void disk.delete(key)),
  keys: jest.fn(async () => [...disk.keys()]),
  clear: jest.fn(async () => disk.clear()),
}));

/**
 * Backlog item 45: a replaced credential rendered as if it were current.
 *
 * <p>Item 20 made renewing archive the document it replaces — a marker, never a delete — and taught
 * both of `web/`'s lists to label the archived row. This screen was left alone, so after renewing in
 * the app a clinician saw **two** licences, the older one still carrying its lapsed expiry date and
 * its VERIFIED badge, with `byNewest()` ordering as the only hint which was current. That reads as a
 * compliance problem the clinician has already fixed.
 *
 * <p>The real catalogues are loaded rather than stubbed, in all four languages, because the second
 * half of this item is that the status badge was `verificationStatus.toLowerCase()` — raw English on
 * every locale. `untranslated-literals.spec.ts` cannot see it: an interpolation is not a literal.
 * A stubbed loader that echoes keys would pass while the screen showed "verified" to a German user.
 */
describe('DocumentsPage — a replaced credential says so', () => {
  const licence = (over: Partial<PersonalDocumentDto> = {}): PersonalDocumentDto => ({
    id: 'doc-1',
    type: 'LICENSE',
    verificationStatus: 'VERIFIED',
    expiryDate: '2026-01-31',
    name: 'licence.pdf',
    supersededAt: null,
    ...over,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DocumentsPage, TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: BundledTranslateLoader } })],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    TestBed.inject(TranslateService).setDefaultLang('en');
  });

  /**
   * Renders the page over `documents`, in `language`.
   *
   * <p>`set` is awaited, and that is not incidental: it writes the cache before the signal settles, so
   * creating the component without awaiting renders an empty list. Three of these tests passed that
   * way while asserting nothing at all — an absence assertion over an empty screen is vacuous, which
   * is why `rowCount` is checked in every case that expects a row.
   */
  async function render(documents: PersonalDocumentDto[], language = 'en') {
    TestBed.inject(TranslateService).use(language);
    await TestBed.inject(DocumentsStore).documents.set(documents);
    const fixture = TestBed.createComponent(DocumentsPage);
    fixture.detectChanges();
    return fixture;
  }

  type Fixture = Awaited<ReturnType<typeof render>>;
  const badges = (fixture: Fixture) => fixture.debugElement.queryAll(By.css('[data-cy="supersededBadge"]'));
  const rowCount = (fixture: Fixture) => fixture.debugElement.queryAll(By.css('ion-item')).length;

  it('labels the replaced row and leaves the current one unlabelled', async () => {
    const fixture = await render([
      licence({ id: 'old', supersededAt: '2026-09-07T10:00:00Z', expiryDate: '2026-01-31' }),
      licence({ id: 'new', supersededAt: null, expiryDate: '2027-01-31' }),
    ]);

    // Both rows must actually be on screen, or the badge count below means nothing.
    expect(rowCount(fixture)).toBe(2);
    // One badge, not two and not none: the point is that the two rows are distinguishable.
    expect(badges(fixture)).toHaveLength(1);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Replaced');
  });

  /**
   * The dimming, asserted separately because it is a second signal and nothing else covers it —
   * deleting `[class.opacity-60]` failed none of the other tests, so the inversion was measuring the
   * badge alone. `opacity-60` on the host composites the whole `ion-item` including its shadow DOM,
   * which is why the same idiom works in web's two document lists.
   */
  it('dims the replaced row and only that row', async () => {
    const fixture = await render([
      licence({ id: 'old', supersededAt: '2026-09-07T10:00:00Z' }),
      licence({ id: 'new', supersededAt: null, expiryDate: '2027-01-31' }),
    ]);

    const rows = fixture.debugElement.queryAll(By.css('ion-item'));
    expect(rows).toHaveLength(2);
    expect(rows.filter(row => row.classes['opacity-60'])).toHaveLength(1);
  });

  /**
   * `verificationStatus` is nullable on the server, and item 20's review recorded that the generated
   * `PUT /api/personal-documents/{id}` full-save can wipe it. Without the fallback the key itself
   * renders — `documents.verification.undefined`, mid-screen, nothing thrown and nothing logged,
   * which is the failure mode this repo's i18n gates exist for. web guards it the same way.
   */
  it('falls back to PENDING rather than rendering a key when the status is missing', async () => {
    const fixture = await render([{ ...licence(), verificationStatus: undefined as never }]);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(rowCount(fixture)).toBe(1);
    expect(text).toContain('Pending review');
    expect(text).not.toContain('documents.verification');
  });

  it('labels nothing when no document has been replaced', async () => {
    const fixture = await render([licence({ id: 'only' })]);

    expect(rowCount(fixture)).toBe(1);
    expect(badges(fixture)).toHaveLength(0);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Replaced');
  });

  /**
   * `supersededAt` is absent on rows written before item 20's marker existed, and `null` on rows that
   * have simply not been replaced. Both mean current, and a truthiness test would agree — but so would
   * one that treated the field as a boolean, which it is not.
   */
  it('treats an absent supersededAt as current, not as replaced', async () => {
    const fixture = await render([{ ...licence(), supersededAt: undefined }]);

    expect(rowCount(fixture)).toBe(1);
    expect(badges(fixture)).toHaveLength(0);
  });

  it.each([
    ['en', 'Verified', 'Replaced'],
    ['es', 'Verificado', 'Reemplazado'],
    ['fr', 'Vérifié', 'Remplacé'],
    ['de', 'Verifiziert', 'Ersetzt'],
    // The expected words are web's, not this app's choice — see the catalogue's own note. This case
    // is what caught the divergence: it failed the moment de VERIFIED was corrected to match.
  ])('renders the status and the replaced label in %s', async (language, status, replaced) => {
    const fixture = await render([licence({ id: 'old', supersededAt: '2026-09-07T10:00:00Z' })], language);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(rowCount(fixture)).toBe(1);
    expect(text).toContain(status);
    expect(text).toContain(replaced);
  });

  /**
   * The regression the item names directly: the badge used to be
   * `{{ doc.verificationStatus.toLowerCase() }}`, so every locale showed the English enum in lower
   * case. Asserted as an absence because that is what the defect looked like — the screen was not
   * blank, it was English.
   */
  it('never shows the raw enum, in any language', async () => {
    for (const language of ['en', 'es', 'fr', 'de']) {
      const fixture = await render([licence()], language);
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

      // Without this the assertions below pass on an empty screen, which is how they passed before.
      expect(rowCount(fixture)).toBe(1);
      expect(text).not.toContain('verified');
      expect(text).not.toContain('VERIFIED');
    }
  });
});
