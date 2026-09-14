import { CATALOGUES } from '../i18n/catalogues';
import { RESTRICTED_PARTS, RestrictedPart, parseRestrictedParts } from './restricted-parts';

/**
 * The wire half of `../docs/backlog.md` item 114.
 *
 * <h3>Why the unknown-token case has its own tests</h3>
 * Items 112 and 113 are open against the same composed reads, so a third token is a live
 * possibility rather than a hypothetical. A release that predates it must ignore it — printing
 * `vitals` or the untranslated key `patients.vitalsRestricted` at a clinician is worse than the
 * silence item 114 exists to remove, because it looks like a defect in the app rather than a rule.
 *
 * <h3>Why the catalogue check is here and not in `catalogues.spec.ts`</h3>
 * That spec compares the four locales against each other, so a sentence missing from all four
 * equally leaves them in agreement and it passes. `template-keys.spec.ts` asks whether a key a
 * template names exists — but these two keys are named by templates, so it would pass on a token
 * nobody had written a sentence for at all. The question only this file can ask is whether **every
 * token this app claims to understand has something to say about it**, and that is derived from
 * `RESTRICTED_PARTS` so a token added there fails here rather than reaching a screen.
 */
describe('X-Restricted-Parts', () => {
  describe('parsing', () => {
    it('reads nothing from an absent header — five of the eight disciplines never see one', () => {
      expect(parseRestrictedParts(null)).toEqual([]);
      expect(parseRestrictedParts(undefined)).toEqual([]);
      expect(parseRestrictedParts('')).toEqual([]);
    });

    it('reads the one token a pharmacist and a chemist get', () => {
      expect(parseRestrictedParts('lastActivity')).toEqual(['lastActivity']);
    });

    it('reads both tokens a technician gets', () => {
      expect(parseRestrictedParts('caseAssignments,lastActivity')).toEqual(['caseAssignments', 'lastActivity']);
    });

    it('IGNORES a token this release does not know, and keeps the ones it does', () => {
      // The server may add a third part; an older app must go on working rather than rendering a
      // wire token or a missing translation key.
      expect(parseRestrictedParts('vitals')).toEqual([]);
      expect(parseRestrictedParts('vitals,lastActivity')).toEqual(['lastActivity']);
      expect(parseRestrictedParts('lastActivity,vitals,caseAssignments')).toEqual(['caseAssignments', 'lastActivity']);
    });

    it('does not depend on the order the server sends', () => {
      // item 107's review found `Set.copyOf` does not preserve order, so the header's promised
      // declaration order held only within one JVM run. Reading it order-insensitively means that
      // class of drift changes nothing a clinician sees.
      expect(parseRestrictedParts('lastActivity,caseAssignments')).toEqual(parseRestrictedParts('caseAssignments,lastActivity'));
    });

    it('tolerates the spacing a header may pick up in transit', () => {
      expect(parseRestrictedParts(' caseAssignments , lastActivity ')).toEqual(['caseAssignments', 'lastActivity']);
    });

    it('matches the token exactly — a near-miss spelling is an unknown token', () => {
      expect(parseRestrictedParts('lastactivity')).toEqual([]);
    });
  });

  describe('every token has something to say, in four languages', () => {
    /**
     * The sentences each token becomes, per surface.
     *
     * <p><b>Two surfaces, because one token costs two different things</b> — `../docs/backlog.md`
     * item 129. On the directory `lastActivity` blanks a *column*; on a record it withholds **every
     * activity entry**. Telling a pharmacist that recent-activity sorting is unavailable, when the
     * patient's whole history is missing, is a new false sentence written while removing one.
     *
     * <p>`caseAssignments` has no record sentence and must not grow one: it never reaches
     * `GET /api/patients/{id}`, because a record whose case read was refused is not served at all
     * (item 112). A sentence for it here would be copy for a state the server cannot produce.
     */
    const SENTENCES_FOR: Record<RestrictedPart, { directory: string; record: string | null }> = {
      caseAssignments: { directory: 'patients.rowsRestricted', record: null },
      lastActivity: { directory: 'patients.recencyRestricted', record: 'patients.activityRestricted' },
    };

    const KEYS = Object.values(SENTENCES_FOR).flatMap(surfaces => [surfaces.directory, surfaces.record].filter(key => key !== null));

    const resolve = (catalogue: unknown, key: string): unknown =>
      key
        .split('.')
        .reduce<unknown>((node, part) => (typeof node === 'object' && node !== null ? (node as never)[part] : undefined), catalogue);

    it('covers every token the parser will hand to a screen', () => {
      expect(Object.keys(SENTENCES_FOR).sort()).toEqual([...RESTRICTED_PARTS].sort());
    });

    it.each(Object.keys(CATALOGUES))('%s carries a sentence for each token', language => {
      const missing = KEYS.filter(key => typeof resolve(CATALOGUES[language as keyof typeof CATALOGUES], key) !== 'string');

      // Named, not counted: a failure should say which sentence to write and in which language.
      expect(missing).toEqual([]);
    });

    it.each(Object.keys(CATALOGUES))('%s says something DIFFERENT for every loss it names', language => {
      const sentences = KEYS.map(key => resolve(CATALOGUES[language as keyof typeof CATALOGUES], key));

      // A blank field, a missing patient and a withheld history are three different pieces of news.
      // One translation covering two would repeat item 107's own conflation inside the fix for it,
      // which is exactly the trap item 129 records against the record screen.
      expect(new Set(sentences).size).toBe(sentences.length);
    });

    it.each(Object.keys(CATALOGUES).filter(language => language !== 'en'))(
      '%s says it in its own language rather than repeating the English',
      language => {
        // `../docs/backlog.md` item 123: all three i18n gates in this repo compare KEY sets, so
        // English pasted into es/fr/de leaves every one of them green and looks perfect in the only
        // locale anyone here reads. These are whole sentences with no proper noun in them, so no
        // allowlist is needed — and none should be added without an argument.
        const untranslated = KEYS.filter(
          key => resolve(CATALOGUES[language as keyof typeof CATALOGUES], key) === resolve(CATALOGUES.en, key),
        );

        expect(untranslated).toEqual([]);
      },
    );
  });
});
