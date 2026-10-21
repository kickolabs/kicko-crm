import { describe, expect, it } from 'vitest';
import { compareWithProfile, heuristicRead, mergeIssues, type DocRead } from './doc-check';

const now = new Date('2026-10-21T00:00:00Z');
const profile = { fullName: 'Priya Raman', dob: new Date('1999-04-12T00:00:00Z'), passportNumber: 'Z1234567' };
const read = (fields: Partial<DocRead['fields']>, over: Partial<DocRead> = {}): DocRead => ({
  documentType: 'Indian passport, data page',
  matchesExpected: 'yes',
  legible: true,
  fields: { fullName: null, dateOfBirth: null, documentNumber: null, issueDate: null, expiryDate: null, issuingCountry: null, ...fields },
  issues: [],
  ...over,
});
const passport = { name: 'Passport (all pages)' };

describe('AI document check: comparison with the profile (code, not AI)', () => {
  it('passes a matching passport, even with the name order swapped', () => {
    expect(compareWithProfile(read({ fullName: 'RAMAN PRIYA', dateOfBirth: '1999-04-12', documentNumber: 'Z 1234567', expiryDate: '2032-01-01' }), passport, profile, now)).toEqual([]);
  });
  it('flags a different person, a wrong date of birth and a wrong passport number', () => {
    const issues = compareWithProfile(read({ fullName: 'Arjun Mehta', dateOfBirth: '1998-01-02', documentNumber: 'K7654321' }), passport, profile, now);
    expect(issues.map((i) => i.severity)).toEqual(['high', 'high', 'high']);
    expect(issues[0]!.message).toContain("doesn't match the client");
    expect(issues[1]!.message).toContain('Date of birth');
    expect(issues[2]!.message).toContain('Passport number K7654321');
  });
  it('notes a partial name difference softly', () => {
    expect(compareWithProfile(read({ fullName: 'Priya Lakshmi Ramanathan' }), passport, profile, now)).toEqual([
      { severity: 'low', message: expect.stringContaining('Name differs slightly') },
    ]);
  });
  it('flags expired, and passports with under six months left', () => {
    expect(compareWithProfile(read({ expiryDate: '2026-01-01' }), passport, profile, now)[0]).toMatchObject({ severity: 'high', message: 'Expired on 01 Jan 2026.' });
    expect(compareWithProfile(read({ expiryDate: '2027-02-01' }), passport, profile, now)[0]).toMatchObject({ severity: 'medium', message: expect.stringContaining('under 6 months') });
    expect(compareWithProfile(read({ expiryDate: '2027-12-01' }), passport, profile, now)).toEqual([]);
  });
  it('flags the wrong document and unreadable scans', () => {
    const issues = compareWithProfile(read({}, { documentType: 'bank statement', matchesExpected: 'no', legible: false }), passport, profile, now);
    expect(issues.map((i) => i.message)).toEqual(['This looks like a bank statement, not "Passport (all pages)".', 'Hard to read. Ask for a clearer scan or photo.']);
  });
  it('merges model and code issues without duplicates, worst first', () => {
    const m = mergeIssues([{ severity: 'low', message: 'Corner cut off' }], [{ severity: 'high', message: 'Expired on 01 Jan 2026.' }, { severity: 'low', message: 'corner cut off' }]);
    expect(m).toEqual([{ severity: 'high', message: 'Expired on 01 Jan 2026.' }, { severity: 'low', message: 'Corner cut off' }]);
  });
});

describe('sandbox document check (file name, type and size only)', () => {
  it('spots an obviously wrong file by its name', () => {
    expect(heuristicRead({ mime: 'application/pdf', fileName: 'HDFC_bank_statement_sep.pdf', size: 200_000 }, passport)).toMatchObject({ matchesExpected: 'no', documentType: 'bank or financial statement' });
  });
  it('accepts a matching name and is unsure about generic names', () => {
    expect(heuristicRead({ mime: 'image/jpeg', fileName: 'passport-front.jpg', size: 400_000 }, passport).matchesExpected).toBe('yes');
    expect(heuristicRead({ mime: 'image/jpeg', fileName: 'IMG_2041.jpg', size: 400_000 }, passport).matchesExpected).toBe('unsure');
  });
  it('treats tiny images as probably unreadable', () => {
    expect(heuristicRead({ mime: 'image/jpeg', fileName: 'passport.jpg', size: 9_000 }, passport).legible).toBe(false);
  });
});
