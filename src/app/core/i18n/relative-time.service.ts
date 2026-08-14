import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

import { describeAge } from '../offline/cached-resource';
import { LanguageService } from './language.service';

/**
 * Renders a cache age — "just now", "vor 12 Min." — in the active language.
 *
 * <p>Three screens show this beside their "updated" label, from inside a `computed()`. That rules
 * out the `translate` pipe, and `TranslateService.instant` on its own is not enough: it is an
 * ordinary function call, so a `computed()` that uses it holds whatever language was active when
 * its tracked dependencies last changed. Reading `language.current()` here is what makes the chip
 * follow a language switch.
 *
 * <p>It lives in one service rather than being repeated per page precisely because that read looks
 * like a redundant statement and gets deleted; there is one copy to protect, and a spec that fails
 * when it goes.
 */
@Injectable({ providedIn: 'root' })
export class RelativeTime {
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);

  describe(fetchedAt: number | null, now: number): string {
    this.language.current();
    const { key, params } = describeAge(fetchedAt, now);
    return this.translate.instant(key, params);
  }
}
