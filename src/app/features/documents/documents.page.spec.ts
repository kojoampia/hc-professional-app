import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { computed } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { TranslateLoader, TranslateModule, TranslateService } from '@ngx-translate/core';

import { BundledTranslateLoader, LanguageService } from '../../core/i18n/language.service';
import { DOCUMENT_TYPES, DocumentType, PersonalDocumentDto } from '../../core/api/onboarding-api.service';
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

beforeEach(() => {
  disk.clear();
  TestBed.resetTestingModule();
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
const screenText = (fixture: Fixture) => (fixture.nativeElement as HTMLElement).textContent ?? '';

/**
 * Text nodes only, whitespace collapsed.
 *
 * <p>Not `textContent`: Angular's control-flow blocks leave `<!--container-->` anchors in the
 * markup and this environment folds a comment's body into `textContent`, so an `ion-label` holding
 * the single word "License" reads as `License container`. That is invisible to a `toContain` and
 * fatal to an equality — and an equality is what the interesting cases here need, since the row
 * title is now a composed string rather than one word.
 */
const visibleText = (element: HTMLElement): string => {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let collected = '';
  while (walker.nextNode()) {
    collected += walker.currentNode.nodeValue ?? '';
  }
  return collected.replace(/\s+/g, ' ').trim();
};

/**
 * The row titles alone.
 *
 * <p>Scoped to the rows rather than read off the whole screen, because the page title is
 * "Documents" / "Dokumente" and the fallback word for an untyped row is "Document" / "Dokument" —
 * so a `toContain` over the document body would pass without a row ever having been drawn.
 */
const titles = (fixture: Fixture): string[] =>
  fixture.debugElement.queryAll(By.css('ion-item ion-label')).map(label => visibleText(label.nativeElement as HTMLElement));

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

/**
 * Backlog item 58: the document *type* rendered raw, one field over from item 45's status badge.
 *
 * <p>`label(doc)` returned `doc.otherLabel || doc.type.toLowerCase()` and the upload picker rendered
 * `option.toLowerCase()`, so both surfaces that name a credential read `license`, `certificate`,
 * `nhis` — English, on all four locales, with `web/` naming the same nine documents in the reader's
 * language throughout. It survived every gate for the reason item 45's badge did: `catalogues.spec.ts`
 * compares key sets and a group nobody wrote is not drift, and `untranslated-literals.spec.ts` reads
 * templates for visible text and attributes, neither of which an interpolation is.
 *
 * <p><b>The real catalogues are loaded, in all four languages.</b> A key-echoing stub would pass every
 * case below while a German reader saw `license`, which is the whole defect.
 *
 * @see document-type-names.spec.ts, which holds the catalogues to `DOCUMENT_TYPES` in both
 *     directions. It cannot see the wording; this file can, and the words it expects are `web/`'s.
 */
describe('DocumentsPage — a document type reads in the reader’s language', () => {
  const doc = (over: Partial<PersonalDocumentDto> = {}): PersonalDocumentDto => ({
    id: 'doc-1',
    type: 'LICENSE',
    verificationStatus: 'VERIFIED',
    name: 'licence.pdf',
    supersededAt: null,
    ...over,
  });

  /**
   * `web/`'s `healthConnect.onboarding.documentTypes.*`, transcribed per locale.
   *
   * <p>Listed rather than derived from the catalogue, deliberately: derived, this would assert that
   * the screen renders whatever the catalogue happens to say, which is true of the defect too. What
   * has to be pinned is that the words are **web's**, since item 45 shipped four wrong translations
   * by writing them instead of copying them.
   */
  const WEB_WORDS: Record<string, Record<DocumentType, string>> = {
    en: {
      CERTIFICATE: 'Professional certificate',
      LICENSE: 'License',
      PASSPORT: 'Passport',
      GHANACARD: 'Ghana Card',
      DRIVERLICENSE: "Driver's license",
      VOTERCARD: 'Voter card',
      PASSPHOTO: 'Passport photo',
      NHIS: 'NHIS card',
      OTHER: 'Other',
    },
    es: {
      CERTIFICATE: 'Certificado profesional',
      LICENSE: 'Licencia',
      PASSPORT: 'Pasaporte',
      GHANACARD: 'Ghana Card',
      DRIVERLICENSE: 'Permiso de conducir',
      VOTERCARD: 'Tarjeta de votante',
      PASSPHOTO: 'Foto de pasaporte',
      NHIS: 'Tarjeta NHIS',
      OTHER: 'Otro',
    },
    fr: {
      CERTIFICATE: 'Certificat professionnel',
      LICENSE: 'Licence',
      PASSPORT: 'Passeport',
      GHANACARD: 'Carte Ghana',
      DRIVERLICENSE: 'Permis de conduire',
      VOTERCARD: "Carte d'électeur",
      PASSPHOTO: "Photo d'identité",
      NHIS: 'Carte NHIS',
      OTHER: 'Autre',
    },
    de: {
      CERTIFICATE: 'Berufszertifikat',
      LICENSE: 'Lizenz',
      PASSPORT: 'Reisepass',
      GHANACARD: 'Ghana Card',
      DRIVERLICENSE: 'Führerschein',
      VOTERCARD: 'Wählerausweis',
      PASSPHOTO: 'Passfoto',
      NHIS: 'NHIS-Karte',
      OTHER: 'Sonstiges',
    },
  };

  const LANGUAGES = ['en', 'es', 'fr', 'de'] as const;

  // ─── Surface one: the row title ───────────────────────────────────────────────────────────────

  it.each(LANGUAGES)('titles every row with web’s word for its type in %s', async language => {
    const fixture = await render(
      DOCUMENT_TYPES.map(type => doc({ id: type, type })),
      language,
    );

    // The positive control. Nine expected words checked against an empty list is nine vacuous
    // assertions, which is how three of item 45's first-draft cases passed.
    expect(rowCount(fixture)).toBe(DOCUMENT_TYPES.length);
    expect(titles(fixture).sort()).toEqual(DOCUMENT_TYPES.map(type => WEB_WORDS[language][type]).sort());
  });

  it.each(LANGUAGES)('never leaves a catalogue key on screen in %s', async language => {
    const fixture = await render(
      DOCUMENT_TYPES.map(type => doc({ id: type, type })),
      language,
    );

    expect(rowCount(fixture)).toBe(DOCUMENT_TYPES.length);
    expect(screenText(fixture)).not.toContain('documents.documentTypes');
  });

  it.each(LANGUAGES)('never leaves the raw lower-cased enum on screen in %s', async language => {
    // The defect as a clinician met it: the screen was not blank, it was English.
    const fixture = await render(
      DOCUMENT_TYPES.map(type => doc({ id: type, type })),
      language,
    );

    expect(rowCount(fixture)).toBe(DOCUMENT_TYPES.length);
    expect(titles(fixture)).not.toContain('license');
    expect(titles(fixture)).not.toContain('nhis');
    expect(titles(fixture)).not.toContain('certificate');
  });

  // ─── Surface two: the upload picker ───────────────────────────────────────────────────────────

  /**
   * The picker's options cannot be asserted in the DOM: they live inside an `ion-modal`, whose
   * `ng-template` Ionic stamps into an overlay that jsdom never instantiates — measured here, not
   * assumed, and the same constraint `patients.page.spec.ts` and `reachable-members.spec.ts` were
   * written around. So the *wording* is asserted through the method the option binds to, and the
   * *wiring* — that it binds to that method, and that what it posts is still the enum and not the
   * word — is asserted against the template source below.
   */
  it.each(LANGUAGES)('offers every renewable type by web’s word in %s', async language => {
    const fixture = await render([], language);
    const page = fixture.componentInstance;

    expect(page.types.length).toBeGreaterThan(0);
    expect(page.types.map(type => page.typeName(type))).toEqual(page.types.map(type => WEB_WORDS[language][type]));
  });

  /**
   * The whole element, attributes included — not only the text between the tags.
   *
   * <p>This matched `<ion-select-option [^>]*>` at first and asserted the display expression alone,
   * which left the **value** unpinned: `[value]="typeName(option)"` posts the translated word to the
   * server as the document type, and the entire suite stayed green. That is worse than the defect
   * this item fixes. A screen reading `license` is a legibility problem; a Spanish phone uploading
   * `type=Licencia` is a write the server rejects, and on a German one `type=Lizenz`. It is also
   * precisely the half of the picker that a DOM assertion would have covered for nothing, if jsdom
   * stamped the modal at all — so the source check has to carry both halves or it carries the less
   * important one.
   */
  it('binds the picker option to the same method the row title uses, and still posts the type itself', async () => {
    const source = readFileSync(join(__dirname, 'documents.page.ts'), 'utf8');
    const option = /<ion-select-option\b[^>]*>.*?<\/ion-select-option>/.exec(source);

    // The whole tag, so an attribute added or altered here has to be looked at rather than slipping
    // through a wildcard.
    expect(option?.[0]).toBe('<ion-select-option [value]="option">{{ typeName(option) }}</ion-select-option>');
    // The regression by name. Two copies of `toLowerCase()` is how the same defect reached two
    // surfaces; one method is what keeps them from drifting apart again.
    expect(source).not.toContain('option.toLowerCase()');
  });

  // ─── otherLabel ───────────────────────────────────────────────────────────────────────────────

  it.each(LANGUAGES)('shows the type and then the clinician’s own label on an OTHER row in %s', async language => {
    const fixture = await render([doc({ type: 'OTHER', otherLabel: 'Ghana Medical Council card' })], language);

    expect(rowCount(fixture)).toBe(1);
    // Both, not either: "Other" alone loses the only description there is, and the label alone
    // loses the word saying this document is outside the standard set.
    expect(titles(fixture)).toEqual([`${WEB_WORDS[language].OTHER} · Ghana Medical Council card`]);
  });

  /**
   * A label on a row that is not `OTHER` — reachable, not hypothetical. `web/`'s upload form hides
   * the label control when the type is not `OTHER` but keeps its value, sends it whatever the type
   * is, and `OnboardingDocumentResource.validate` only *requires* it for `OTHER`, so it stores it.
   * Under the old `otherLabel || type` the row then read as the label alone, with nothing saying it
   * was the clinician's licence.
   */
  it('does not let a stray label hide the type', async () => {
    const fixture = await render([doc({ type: 'LICENSE', otherLabel: 'front and back' })]);

    expect(rowCount(fixture)).toBe(1);
    expect(titles(fixture)).toEqual(['License · front and back']);
  });

  it('shows the type alone when there is no label', async () => {
    const fixture = await render([doc({ type: 'CERTIFICATE' })]);

    expect(rowCount(fixture)).toBe(1);
    expect(titles(fixture)).toEqual(['Professional certificate']);
  });

  // ─── The two fallbacks ────────────────────────────────────────────────────────────────────────

  /**
   * A type this build does not know — the server's enum gaining a value after a release. The key
   * itself must not reach the screen; the server's own word is what stands in, because a generic
   * one would make two unknown credentials read identically on a list that is one row per document.
   */
  it.each(LANGUAGES)('falls back to the server’s own word for an unknown type in %s', async language => {
    const fixture = await render([doc({ type: 'BIOMETRIC' as DocumentType })], language);

    expect(rowCount(fixture)).toBe(1);
    expect(titles(fixture)).toEqual(['BIOMETRIC']);
    expect(screenText(fixture)).not.toContain('documents.documentTypes');
  });

  /**
   * No type at all. `PersonalDocument.type` carries no `@NotNull`, and item 20's review recorded
   * that the generated full-save `PUT` wipes what it is not given — which is how
   * `verificationStatus` came to need its own guard on this screen.
   */
  it.each([
    ['en', 'Document'],
    ['es', 'Documento'],
    ['fr', 'Document'],
    ['de', 'Dokument'],
  ])('falls back to a neutral word rather than a key or "undefined" for a typeless row in %s', async (language, word) => {
    const fixture = await render([{ ...doc(), type: undefined as never }], language);

    expect(rowCount(fixture)).toBe(1);
    expect(titles(fixture)).toEqual([word]);
    // Both shapes the absence used to take: `documents.documentTypes.undefined` through the
    // catalogue, and the bare string "undefined" through the raw-value fallback beside it.
    expect(screenText(fixture)).not.toContain('documents.documentTypes');
    expect(titles(fixture)).not.toContain('undefined');
  });

  /**
   * A language change while the screen is already up.
   *
   * <p>`typeName` translates through `translate.instant`, a plain call that notifies nothing, so
   * under OnPush the words would simply stay as they were — the one thing the `| translate` pipe
   * used elsewhere in this template does for free. The signal read at the top of the method is what
   * buys it back, and **nothing else in this file fails when that line is deleted**: measured.
   *
   * <p>Asserted through a `computed` rather than through the DOM, and the difference is the whole
   * point. `ComponentFixture.detectChanges()` checks the fixture's own component whether or not it
   * is dirty, so a DOM assertion here passes with the line deleted — vacuously. `ApplicationRef
   * .tick()`, which does respect OnPush, never reaches the view at all because a fixture created
   * this way is not attached to it. A `computed` tracks reads exactly as the template's reactive
   * context does and recomputes only when one of them changes, which is the property under test.
   */
  it('re-reads its words when the language changes', async () => {
    const fixture = await render([], 'en');
    const page = fixture.componentInstance;
    const title = TestBed.runInInjectionContext(() => computed(() => page.typeName('LICENSE')));

    expect(title()).toBe('License');

    await TestBed.inject(LanguageService).use('de');

    expect(title()).toBe('Lizenz');
  });

  it.each(LANGUAGES)('does not borrow OTHER’s word for either fallback in %s', async language => {
    // OTHER is a real value that arrives with a required otherLabel. Borrowing its word would make
    // a row this build cannot name indistinguishable from a sound one.
    const fixture = await render(
      [doc({ id: 'unknown', type: 'BIOMETRIC' as DocumentType }), { ...doc({ id: 'none' }), type: undefined as never }],
      language,
    );

    expect(rowCount(fixture)).toBe(2);
    expect(titles(fixture)).not.toContain(WEB_WORDS[language].OTHER);
  });
});
