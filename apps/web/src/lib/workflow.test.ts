import { describe, expect, it } from 'vitest';
import { gateProblems, lodgedBy, mainStages, overdueDays, ruleMatches, snapshotFor, stagesOf } from './workflow';
import { checklistToText, parseChecklist, parseStages, stagesToText } from './workflow-text';

const checklist = parseChecklist(
  [
    'Identity: Passport (all pages) [expires]',
    'Character: Police clearance certificate [expires]',
    'Licences: Driving licence (HMV) [when: drivers]',
    'Licences: Nursing council registration [when: healthcare]',
    'Employment: Experience letters (optional)',
  ].join('\n'),
);
const stages = parseStages(
  [
    'Consultation',
    'Documents [requires: Passport (all pages), Police clearance certificate] [7d]',
    'Driving test [when: drivers] [task: Book the GCC driving test +5d]',
    'Medical [track]',
    'Lodged [lodged]',
    'Decision',
  ].join('\n'),
  checklist,
);

describe('workflow text', () => {
  it('reads stage flags', () => {
    expect(stages.map((s) => s.key)).toEqual(['consultation', 'documents', 'driving_test', 'medical', 'lodged', 'decision']);
    expect(stages[1]).toMatchObject({ deadlineDays: 7, requires: { documents: ['identity_passport_all_pages', 'character_police_clearance_certificate'] } });
    expect(stages[2]).toMatchObject({ when: { occupationGroups: ['drivers'] }, tasks: [{ title: 'Book the GCC driving test', dueDays: 5 }] });
    expect(stages[3]!.track).toBe('medical');
    expect(stages[4]!.lodged).toBe(true);
  });

  it('round-trips stages and checklists through text', () => {
    expect(parseStages(stagesToText(stages, checklist), checklist)).toEqual(stages);
    expect(parseChecklist(checklistToText(checklist))).toEqual(checklist);
  });

  it('keeps plain lines working and refuses bad input', () => {
    expect(parseStages('One\nTwo')).toEqual([{ key: 'one', name: 'One' }, { key: 'two', name: 'Two' }]);
    expect(() => parseStages('Only one')).toThrow('at least two');
    expect(() => parseStages('A\nA')).toThrow('unique');
    expect(() => parseStages('A [sparkle]\nB')).toThrow('unknown flag');
  });
});

describe('workflow engine', () => {
  it('builds a snapshot with only the steps that apply to the applicant', () => {
    const product = { name: 'GCC work visa', stages, checklist };
    const driver = snapshotFor(product, { occupationGroup: 'drivers' });
    const nurse = snapshotFor(product, { occupationGroup: 'healthcare' });
    expect(driver.stages.map((s) => s.key)).toContain('driving_test');
    expect(nurse.stages.map((s) => s.key)).not.toContain('driving_test');
    expect(driver.checklist.map((c) => c.name)).toContain('Driving licence (HMV)');
    expect(driver.checklist.map((c) => c.name)).not.toContain('Nursing council registration');
    expect(nurse.checklist.map((c) => c.name)).toContain('Nursing council registration');
  });

  it('matches rules on employer, dependants and field values', () => {
    expect(ruleMatches({ hasEmployer: true }, { hasEmployer: false })).toBe(false);
    expect(ruleMatches({ hasDependants: true }, { hasDependants: true })).toBe(true);
    expect(ruleMatches({ field: { key: 'service', in: ['Job placement + visa'] } }, { fields: { service: 'job placement + visa' } })).toBe(true);
    expect(ruleMatches({ field: { key: 'langs', in: ['de'] } }, { fields: { langs: ['EN', 'DE'] } })).toBe(true);
    expect(ruleMatches(undefined, {})).toBe(true);
  });

  it('prefers the case snapshot over the product, and separates side tracks', () => {
    const snapCase = { workflow: { stages: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }] }, product: { stages } };
    expect(stagesOf(snapCase).map((s) => s.key)).toEqual(['a', 'b']);
    expect(stagesOf({ workflow: null, product: { stages } })).toHaveLength(stages.length);
    expect(mainStages(stages).map((s) => s.key)).not.toContain('medical');
  });

  it('explains what a gate is waiting for', () => {
    const docStage = stages[1];
    const docs = { identity_passport_all_pages: 'VERIFIED', character_police_clearance_certificate: 'UPLOADED' };
    expect(gateProblems(docStage, { docs, docName: (k) => (k.startsWith('character') ? 'Police clearance certificate' : k) })).toEqual(['Police clearance certificate is not verified yet']);
    expect(gateProblems(docStage, { docs: { ...docs, character_police_clearance_certificate: 'VERIFIED' } })).toEqual([]);
    expect(gateProblems({ key: 'x', name: 'X', requires: { followUp: true } }, { docs: {}, hasFollowUp: false })).toEqual(['Schedule a follow-up first']);
  });

  it('finds the lodged stage by its flag, and overdue days by the stage deadline', () => {
    expect(lodgedBy(stages, 'decision')).toBe(true);
    expect(lodgedBy(stages, 'documents')).toBe(false);
    const since = new Date('2026-10-01T00:00:00Z');
    expect(overdueDays(stages[1], since, new Date('2026-10-05T00:00:00Z'))).toBe(0);
    expect(overdueDays(stages[1], since, new Date('2026-10-12T00:00:00Z'))).toBe(4);
  });
});
