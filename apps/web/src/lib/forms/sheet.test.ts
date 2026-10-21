import { describe, expect, it } from 'vitest';
import type { Answers } from './questions';
import { buildSheet, formById, FORMS, sheetText, type SheetClient } from './sheet';

const client: SheetClient = {
  firstName: 'Priya', lastName: 'Raman', email: 'priya@example.com', phone: '+919840011223', dob: '1999-04-12', gender: 'Female',
  nationality: 'Indian', passportNumber: 'Z1234567', passportExpiry: '2032-01-09', maritalStatus: 'Single', address: '12 Anna Nagar, Chennai',
  education: [{ level: "Bachelor's", field: 'Computer Science', institution: 'Anna University', year: '2021' }],
  tests: [{ test: 'IELTS', overall: '7.5', l: '8', r: '7', w: '7', s: '7.5', date: '2026-03-02' }],
  work: [{ employer: 'Infosys', title: 'Software Engineer', from: '2021-07' }],
  family: [{ relation: 'PARENT', name: 'Raman K', dob: null, passportNumber: null }],
};
const a = (o: Record<string, string>, by: 'client' | 'staff' = 'client'): Answers => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { v, by, at: '2026-10-22T00:00:00Z' }]));
const row = (s: ReturnType<typeof buildSheet>, label: string) => s.sections.flatMap((x) => x.rows).find((r) => r.label === label)!;

describe('government form sheets', () => {
  it('uses each form\'s own date format', () => {
    expect(row(buildSheet(formById('ca-personal')!, client, {}), 'Date of birth').value).toBe('1999-04-12');
    expect(row(buildSheet(formById('us-ds160')!, client, {}), 'Date of birth').value).toBe('12-APR-1999');
    expect(row(buildSheet(formById('au-immi')!, client, {}), 'Date of birth').value).toBe('12 Apr 1999');
  });

  it('fills from the profile and lists what to ask the client', () => {
    const s = buildSheet(formById('ca-personal')!, client, {});
    expect(row(s, 'Passport number')).toMatchObject({ value: 'Z1234567', source: 'profile' });
    expect(row(s, 'English test').value).toBe('IELTS 7.5 (L 8 R 7 W 7 S 7.5), 2026-03-02');
    expect(row(s, 'Employment, last 10 years').value).toBe('2021-07 to present: Software Engineer, Infosys');
    expect(row(s, 'City/town of birth')).toMatchObject({ value: null, source: 'missing', ask: 'birth.city' });
    expect(s.missingAsk).toEqual(expect.arrayContaining(['birth.city', 'birth.country', 'refused', 'native_language']));
    expect(s.filled + s.missingAsk.length + s.missingProfile.length).toBeGreaterThanOrEqual(s.total);
  });

  it('answers are shared across forms, keep who gave them, and dates are reformatted', () => {
    const answers = a({ 'birth.city': 'Madurai', 'passport.issue_date': '2022-01-10' });
    const ca = buildSheet(formById('ca-personal')!, client, answers);
    const us = buildSheet(formById('us-ds160')!, client, answers);
    expect(row(ca, 'City/town of birth')).toMatchObject({ value: 'Madurai', source: 'client' });
    expect(row(us, 'City of birth').value).toBe('Madurai');
    expect(row(us, 'Issuance date').value).toBe('10-JAN-2022');
    expect(row(ca, 'Issue date').value).toBe('2022-01-10');
  });

  it('formats yes/no background answers with details', () => {
    const s = buildSheet(formById('au-immi')!, client, a({ refused: 'Yes', 'refused.details': 'UK visitor visa, 2019, funds', criminal: 'No' }, 'staff'));
    expect(row(s, 'Refused a visa or entry, or removed, from any country?')).toMatchObject({ value: 'Yes: UK visitor visa, 2019, funds', source: 'staff' });
    expect(row(s, 'Arrested, charged or convicted of any offence?').value).toBe('No');
  });

  it('DS-160 uses capitals for names; single applicants have no children', () => {
    const us = buildSheet(formById('us-ds160')!, client, {});
    expect(row(us, 'Surnames').value).toBe('RAMAN');
    expect(row(buildSheet(formById('ca-family')!, client, {}), 'Children (name, date of birth)').value).toBe('None');
  });

  it('every form question has a label, and copy-all text includes missing markers', () => {
    for (const f of FORMS) for (const s of f.sections) for (const x of s.fields) expect(x.label.length).toBeGreaterThan(2);
    expect(sheetText(buildSheet(formById('us-ds160')!, client, {}), 'Priya Raman')).toContain('City of birth: [missing]');
  });
});
