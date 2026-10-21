import { describe, expect, it } from 'vitest';
import { cfClean, cfDisplay, cfKey, parseOptions, type CfDef } from './custom-fields';
import { cleanRow, guessMapping } from './import/fields';

const intake: CfDef = { key: 'intake', label: 'Intake', type: 'select', options: ['Jan', 'May', 'Sept'] };
const budget: CfDef = { key: 'budget', label: 'Budget', type: 'number', options: [] };
const refusal: CfDef = { key: 'refusal', label: 'Refusal history', type: 'yesno', options: [] };
const deadline: CfDef = { key: 'deadline', label: 'Offer deadline', type: 'date', options: [] };

describe('custom field values', () => {
  it('keys are stable slugs, unique per record type', () => {
    expect(cfKey('IELTS band (overall)', [])).toBe('ielts_band_overall');
    expect(cfKey('Intake', ['intake', 'intake_2'])).toBe('intake_3');
  });
  it('cleans each type, and empty clears', () => {
    expect(cfClean(intake, 'sept')).toEqual({ ok: true, value: 'Sept' });
    expect(cfClean(intake, 'Aug')).toMatchObject({ ok: false });
    expect(cfClean(budget, '₹ 12,50,000')).toEqual({ ok: true, value: 1250000 });
    expect(cfClean(budget, 'lots')).toMatchObject({ ok: false });
    expect(cfClean(refusal, 'Yes')).toEqual({ ok: true, value: true });
    expect(cfClean(refusal, 'no')).toEqual({ ok: true, value: false });
    expect(cfClean(deadline, '2026-11-30')).toEqual({ ok: true, value: '2026-11-30' });
    expect(cfClean(deadline, '30/11/2026')).toEqual({ ok: true, value: '2026-11-30' });
    expect(cfClean(budget, '  ')).toEqual({ ok: true, value: null });
  });
  it('displays values', () => {
    expect(cfDisplay(budget, 1250000)).toBe('12,50,000');
    expect(cfDisplay(refusal, false)).toBe('No');
    expect(cfDisplay(deadline, '2026-11-30')).toBe('30 Nov 2026');
  });
  it('parses dropdown options from a textarea', () => {
    expect(parseOptions('Jan\nMay, Sept\n\njan ')).toEqual(['jan', 'May', 'Sept']);
  });
});

describe('importing into custom fields', () => {
  it('maps columns named like the field, and leaves out values that do not fit', () => {
    const custom = [intake, budget];
    const m = guessMapping('leads', ['Name', 'Mobile', 'Intake', 'Budget'], custom);
    expect(m).toMatchObject({ 'cf:intake': 2, 'cf:budget': 3 });
    const ok = cleanRow('leads', ['Asha', '9840012345', 'may', '15,00,000'], m, { country: 'IN', dateOrder: 'DMY', custom });
    expect(ok).toMatchObject({ ok: true, data: { custom: { intake: 'May', budget: 1500000 } }, warnings: [] });
    const bad = cleanRow('leads', ['Asha', '9840012345', 'Someday', ''], m, { country: 'IN', dateOrder: 'DMY', custom });
    expect(bad.ok && bad.data.custom).toBeUndefined();
    expect(bad.ok && bad.warnings).toEqual(["Intake: “Someday” isn't one of the options, left out"]);
  });
});
