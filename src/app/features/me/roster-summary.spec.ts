import { DutyRosterAssignmentDto } from '../../core/api/duty-roster-api.service';
import { formatRosterSummary } from './roster-summary';

describe('formatRosterSummary', () => {
  const assignment = (over: Partial<DutyRosterAssignmentDto>): DutyRosterAssignmentDto => ({
    date: '2026-08-12',
    duty: 'DOCTOR',
    professionalId: 'professional-1',
    shift: 'MORNING',
    name: 'Ward 3',
    ...over,
  });

  const NOW = new Date('2026-08-12T09:00:00Z');

  it('lists upcoming assignments in date order under the given title', () => {
    const text = formatRosterSummary(
      [assignment({ date: '2026-08-14' }), assignment({ date: '2026-08-12' }), assignment({ date: '2026-08-13' })],
      { title: 'My duty roster', from: NOW },
    );

    const lines = text!.split('\n');
    expect(lines[0]).toBe('My duty roster');
    expect(lines.slice(1).map(line => line.slice(0, 10))).toEqual(['2026-08-12', '2026-08-13', '2026-08-14']);
  });

  it('drops assignments that have already passed', () => {
    const text = formatRosterSummary([assignment({ date: '2026-08-01' }), assignment({ date: '2026-08-20' })], {
      title: 'My duty roster',
      from: NOW,
    });

    expect(text).toContain('2026-08-20');
    expect(text).not.toContain('2026-08-01');
  });

  it('returns null when nothing is upcoming, so the sheet is never opened empty', () => {
    // An empty share is worse than none: the sheet opens and the recipient receives a bare title.
    expect(formatRosterSummary([assignment({ date: '2026-08-01' })], { title: 'My duty roster', from: NOW })).toBeNull();
    expect(formatRosterSummary([], { title: 'My duty roster', from: NOW })).toBeNull();
  });

  it('never includes the assignment description', () => {
    // The single most important property here. Description is free text on a clinical system, and
    // shared text leaves the app for WhatsApp, personal email or a screenshot in a group chat.
    const text = formatRosterSummary([assignment({ description: 'Patient Kojo Ampia-Addison, bed 4, suspected fracture' })], {
      title: 'My duty roster',
      from: NOW,
    });

    expect(text).not.toContain('Kojo');
    expect(text).not.toContain('fracture');
    expect(text).not.toContain('bed 4');
  });

  it('includes the shift window when the shift has one', () => {
    const text = formatRosterSummary([assignment({ shift: 'MORNING' })], { title: 'My duty roster', from: NOW });

    expect(text).toContain('MORNING');
    // FLEXIBLE has no fixed window, so it must not gain a parenthesised empty one.
    const flexible = formatRosterSummary([assignment({ shift: 'FLEXIBLE' })], { title: 'My duty roster', from: NOW });
    expect(flexible).not.toContain('()');
  });
});
