import { describe, expect, it } from 'vitest';
import { conditionsMatch, fill, ruleInput } from './rules';

describe('automation rules', () => {
  it('match conditions case-insensitively; empty conditions match everything', () => {
    expect(conditionsMatch({}, { country: 'AE' })).toBe(true);
    expect(conditionsMatch({ country: 'ae' }, { country: 'AE' })).toBe(true);
    expect(conditionsMatch({ country: 'AE', source: 'WEB_FORM' }, { country: 'AE', source: 'CALL' })).toBe(false);
    expect(conditionsMatch({ country: '' }, { country: 'DE' })).toBe(true);
    expect(conditionsMatch({ stageKey: 'medical' }, {})).toBe(false);
  });

  it('fill texts with what happened', () => {
    expect(fill('Call {{name}} about {{stage}}', { name: 'Ravi Kumar', stage: 'Medical' })).toBe('Call Ravi Kumar about Medical');
    expect(fill('Hi {{firstName}}{{missing}}', { firstName: 'Ravi' })).toBe('Hi Ravi');
  });

  it('validate actions and limits', () => {
    const ok = ruleInput.parse({ name: 'Gulf desk', trigger: 'LEAD_CREATED', conditions: { country: 'AE' }, actions: [{ type: 'assign_owner', to: 'least_loaded' }, { type: 'create_task', title: 'Call {{name}}' }] });
    expect(ok.actions[1]).toMatchObject({ type: 'create_task', dueDays: 1, assignTo: 'owner' });
    expect(() => ruleInput.parse({ name: 'x', trigger: 'LEAD_CREATED', actions: [] })).toThrow();
    expect(() => ruleInput.parse({ name: 'Bad', trigger: 'NOPE', actions: [{ type: 'notify', text: 'hi' }] })).toThrow();
    expect(() => ruleInput.parse({ name: 'Bad', trigger: 'LEAD_CREATED', actions: [{ type: 'launch_rocket' }] })).toThrow();
    expect(() => ruleInput.parse({ name: 'Six', trigger: 'LEAD_CREATED', actions: Array(6).fill({ type: 'notify', text: 'hi' }) })).toThrow();
  });
});
