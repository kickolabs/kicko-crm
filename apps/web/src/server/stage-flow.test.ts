import { describe, expect, it } from 'vitest';
import { lodgedBy } from './cases';
import { casePhaseWhere } from './stage-flow';

const stages = ['counselling', 'applications', 'gic', 'lodged', 'biometrics', 'decision'].map((key) => ({ key }));

describe('stage flow phases', () => {
  it('a case counts as lodged at the lodged stage or any stage after it', () => {
    expect(lodgedBy(stages, 'gic')).toBe(false);
    expect(lodgedBy(stages, 'lodged')).toBe(true);
    expect(lodgedBy(stages, 'biometrics')).toBe(true); // skipped past "Lodged"
    expect(lodgedBy([{ key: 'one' }, { key: 'two' }], 'two')).toBe(false); // product without a lodged stage
  });

  it('phases are defined by the recorded dates, so they work for every product', () => {
    const now = new Date('2026-10-22T00:00:00Z');
    expect(casePhaseWhere('preparing', now)).toEqual({ status: { not: 'CLOSED' }, lodgedAt: null, decisionAt: null });
    expect(casePhaseWhere('lodged', now)).toEqual({ status: { not: 'CLOSED' }, lodgedAt: { not: null }, decisionAt: null });
    expect(casePhaseWhere('decided', now)).toEqual({ decisionAt: { gt: new Date('2026-07-24T00:00:00Z') } });
  });
});
