import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

/**
 * One number with a label.
 *
 * <p>Built here rather than in Phase 3 because this is its <b>second</b> consumer — the case queue
 * now, the reduced dashboard next. One consumer is not a component; two is the point at which the
 * label placement and the empty-value rule stop being decided twice.
 *
 * <p><b>An absent value renders as an em dash, never as zero.</b> On a clinical screen "0 urgent" is
 * a statement about a caseload, and a tile that says it because a request failed is worse than a
 * tile that admits it does not know. The server takes the same position: `DashboardResource` omits
 * fields it cannot answer rather than sending zeros.
 */
@Component({
  selector: 'hpd-stat-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslateModule],
  template: `
    <div class="hpd-surface flex flex-1 flex-col gap-1 rounded-hpd-sm px-3 py-2" data-test="stat-tile">
      <span class="text-hpd-muted text-sm">{{ labelKey() | translate }}</span>
      <span class="text-2xl font-semibold" [class.text-hpd-muted]="value() === null">{{ value() ?? '—' }}</span>
    </div>
  `,
})
export class StatTileComponent {
  readonly labelKey = input.required<string>();

  /** Null means "not known", which is not the same as zero and must not render as one. */
  readonly value = input.required<number | null>();
}
