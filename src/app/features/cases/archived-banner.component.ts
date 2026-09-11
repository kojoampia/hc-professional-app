import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';

import { LanguageService } from '../../core/i18n/language.service';

/**
 * "This case has been retired, and here is when."
 *
 * <p>`GET /api/patients/{id}/cases/{caseId}` is the one endpoint in this stack that serves an
 * archived case — the queue and the patient's case list exclude them — so this screen is the only
 * place a retired case can be read, and until now it read exactly like a live one. `api/`'s own
 * `PatientDtos` calls that "a worse answer than the 404 that used to be given", which is the whole of
 * `../docs/backlog.md` item 104.
 *
 * <p><b>It says, and does not gate.</b> No dimming, no removed buttons: a page a clinician cannot act
 * on starts to feel like a page they should not have opened, which is the 404 that item 82 removed,
 * wearing different clothes. The same position `hpd-async-banner` takes about stale data.
 *
 * <p><b>Its own component because the case detail lives in an `ion-modal`</b>, whose content Ionic
 * renders into an overlay jsdom never instantiates. Markup written inline on the page could not be
 * rendered by any test in this repository — the constraint that made the password-reset screens their
 * own component, and the reason `reachable-members.spec.ts` exists at all. Here it can be rendered and
 * read in all four languages, which is what the item asks to be true.
 *
 * <p>The locale comes from {@link LanguageService} rather than from an input because `DatePipe`
 * formats through `LOCALE_ID`, which ngx-translate does not touch: a host that forgot to pass it
 * would show an English date beside German copy, and nothing would fail. One caller today is not a
 * reason to leave that to the caller.
 */
@Component({
  selector: 'hpd-archived-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, TranslateModule],
  template: `
    @if (archivedAt(); as archived) {
      <p class="rounded-hpd-sm bg-hpd-warning-tint mb-3 px-3 py-2 text-hpd-warning" role="status" data-test="archived-banner">
        <strong>{{ 'cases.archivedOn' | translate }} {{ archived | date: 'mediumDate' : undefined : locale() }}</strong>
        <br />
        {{ 'cases.archivedNote' | translate }}
      </p>
    }
  `,
})
export class ArchivedBannerComponent {
  private readonly language = inject(LanguageService);

  /**
   * When the case was retired, or `null`/absent while it is live.
   *
   * <p>Falsiness is deliberately the test rather than `!== null`. The service sends `null` on a live
   * case, but a phone is not redeployed with the service, and one talking to a build that predates
   * item 82 receives no key at all — which must also say nothing rather than be guessed at.
   */
  readonly archivedAt = input<string | null>(null);

  readonly locale = this.language.current;
}
