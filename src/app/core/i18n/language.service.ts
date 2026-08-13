import { Injectable, inject, signal } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeDe from '@angular/common/locales/de';
import localeEs from '@angular/common/locales/es';
import localeFr from '@angular/common/locales/fr';
import { TranslateLoader, TranslateService } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';

/**
 * Angular's own locale data, which is separate from the translation catalogues and easy to forget.
 *
 * <p>`DatePipe` formats through `LOCALE_ID` and knows nothing about ngx-translate, so a German app
 * rendered `EEE d MMM` as "Wed 14 Aug" — English month and weekday names beside fully translated
 * copy. Only `en-US` ships by default; asking for any other locale without registering it first
 * throws `Missing locale data`.
 *
 * <p>Registered at module load rather than in a provider because `DatePipe` resolves locale data
 * synchronously the first time it formats, which can happen before any component runs.
 */
registerLocaleData(localeEs);
registerLocaleData(localeFr);
registerLocaleData(localeDe);

import { PreferencesService } from '../native/preferences.service';
import { CATALOGUES, SUPPORTED_LANGUAGES, SupportedLanguage } from './catalogues';

/** Where the chosen language is remembered. Survives restarts; cleared only by a device wipe. */
const LANGUAGE_KEY = 'hc.language';

/**
 * Serves the bundled catalogues.
 *
 * Synchronous by construction — `of(...)` completes immediately — so the first paint is already
 * translated. A fetching loader leaves one frame of untranslated keys on screen, which on a cold
 * start reads as a rendering bug.
 */
export class BundledTranslateLoader implements TranslateLoader {
  getTranslation(lang: string): Observable<Record<string, unknown>> {
    return of(CATALOGUES[lang as SupportedLanguage] ?? CATALOGUES.en);
  }
}

/**
 * Chooses and remembers the app's language.
 *
 * <p>Precedence is: an explicit choice the clinician made, then the device locale, then English.
 * The device locale is only a starting point — once someone picks a language it wins, because a
 * clinician using an English phone in a francophone ward is a normal situation and the device
 * cannot know which they want.
 *
 * <p>Only the primary subtag is considered: `fr-CA` and `fr-FR` both select `fr`. Shipping regional
 * variants would mean four more catalogues to keep in step for no gain at this vocabulary size.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly translate = inject(TranslateService);
  private readonly preferences = inject(PreferencesService);

  private readonly currentSignal = signal<SupportedLanguage>('en');
  /** The active language, for the picker to bind to. */
  readonly current = this.currentSignal.asReadonly();

  /**
   * Applies the remembered or detected language. Called once during app bootstrap, before the first
   * page renders.
   */
  async initialise(): Promise<void> {
    this.translate.addLangs([...SUPPORTED_LANGUAGES]);
    this.translate.setDefaultLang('en');

    const stored = await this.preferences.get(LANGUAGE_KEY);
    const chosen = this.supported(stored) ?? this.deviceLanguage() ?? 'en';
    this.apply(chosen);
  }

  /** Records an explicit choice and applies it immediately. */
  async use(language: SupportedLanguage): Promise<void> {
    this.apply(language);
    await this.preferences.set(LANGUAGE_KEY, language);
  }

  private apply(language: SupportedLanguage): void {
    this.translate.use(language);
    this.currentSignal.set(language);
  }

  /**
   * The device's language, if it is one this app ships.
   *
   * <p>Guarded because `navigator.language` is absent in some test and server contexts, where an
   * unguarded read would throw during bootstrap and take the whole app down for a cosmetic setting.
   */
  private deviceLanguage(): SupportedLanguage | null {
    const raw = typeof navigator !== 'undefined' ? navigator.language : null;
    return this.supported(raw ? raw.split('-')[0] : null);
  }

  private supported(value: string | null): SupportedLanguage | null {
    return value && (SUPPORTED_LANGUAGES as readonly string[]).includes(value) ? (value as SupportedLanguage) : null;
  }
}
