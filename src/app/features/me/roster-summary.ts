import { DutyRosterAssignmentDto, shiftWindowText } from '../../core/api/duty-roster-api.service';

/**
 * Formats duty assignments as the plain text handed to the OS share sheet.
 *
 * <p>Pure and separate from the page so it can be tested without a share sheet, which is the part
 * that cannot be exercised in a spec at all — `Share.share()` opens a native dialog.
 *
 * <p><strong>No patient data, ever.</strong> A roster names wards, shifts and dates. What gets
 * shared leaves the app entirely — into WhatsApp, a personal email, a screenshot in a group chat —
 * and neither the clinician nor this code controls where it lands. Assignment descriptions are
 * excluded for the same reason: the field is free text on a clinical system and there is no way to
 * know it holds no patient identifiers.
 */
export function formatRosterSummary(
  assignments: readonly DutyRosterAssignmentDto[],
  options: { title: string; from?: Date },
): string | null {
  const from = options.from ?? new Date();
  const fromDay = from.toISOString().slice(0, 10);

  const upcoming = assignments
    .filter(assignment => assignment.date >= fromDay)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  if (upcoming.length === 0) {
    // Null rather than a header with nothing under it: an empty share is worse than no share,
    // because the sheet opens and the recipient gets a title and blank space.
    return null;
  }

  const lines = upcoming.map(assignment => {
    const window = shiftWindowText(assignment.shift);
    const shift = window ? `${assignment.shift} (${window})` : assignment.shift;
    // Ward and duty only. See the note above on why description is left out.
    return `${assignment.date} — ${shift} — ${assignment.duty}${assignment.name ? ` — ${assignment.name}` : ''}`;
  });

  return [options.title, ...lines].join('\n');
}
