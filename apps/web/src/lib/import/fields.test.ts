import { describe, expect, it } from 'vitest';
import { category, cleanRow, countryCode, guessMapping, parseDate, sampleCsv, source, splitName, status } from './fields';

const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

describe('column guessing', () => {
  it('maps the headers agencies actually use', () => {
    const m = guessMapping('leads', ['Sl No', 'Student Name', 'Mobile No.', 'Email ID', 'Lead Source', 'Preferred Country', 'Service', 'Counsellor', 'Remarks', 'Enquiry Date']);
    expect(m).toMatchObject({ fullName: 1, phone: 2, email: 3, source: 4, interestCountry: 5, interestCategory: 6, owner: 7, notes: 8, createdAt: 9, firstName: -1, status: -1 });
  });
  it('prefers first/last columns over a full name, and never reuses a column', () => {
    const m = guessMapping('clients', ['First Name', 'Last Name', 'Name', 'Phone', 'DOB', 'Passport No', 'Passport Expiry Date']);
    expect(m).toMatchObject({ firstName: 0, lastName: 1, fullName: -1, phone: 3, dob: 4, passportNumber: 5, passportExpiry: 6 });
  });
});

describe('cell cleaning', () => {
  it('reads dates in Indian, US, ISO, written and Excel forms', () => {
    expect(iso(parseDate('12/03/2026'))).toBe('2026-03-12');
    expect(iso(parseDate('12/03/2026', 'MDY'))).toBe('2026-12-03');
    expect(iso(parseDate('2026-03-12T10:00:00Z'))).toBe('2026-03-12');
    expect(iso(parseDate('12-Mar-2026'))).toBe('2026-03-12');
    expect(iso(parseDate('March 12, 2026'))).toBe('2026-03-12');
    expect(iso(parseDate('46093'))).toBe('2026-03-12'); // Excel serial
    expect(iso(parseDate('31/02/2026'))).toBeNull();
    expect(iso(parseDate('soon'))).toBeNull();
  });
  it('splits names, maps countries and labels', () => {
    expect(splitName('  Priya  Lakshmi Sharma ')).toEqual({ firstName: 'Priya Lakshmi', lastName: 'Sharma' });
    expect(splitName('Ravi')).toEqual({ firstName: 'Ravi', lastName: null });
    expect(['UK', 'usa', 'Canada', 'au', 'Dubai', 'Japan', 'Atlantis'].map(countryCode)).toEqual(['GB', 'US', 'CA', 'AU', 'AE', 'JP', 'Atlantis']);
    expect(['Student visa', 'UK Skilled Worker', 'Express Entry', 'Tourist', 'Spouse visa', 'Astrology'].map(category)).toEqual(['STUDY', 'WORK', 'PR', 'VISIT', 'FAMILY', null]);
    expect(['Facebook', 'Walk in', 'Google Form', 'Friend', 'Newspaper'].map(source)).toEqual(['ADS', 'WALK_IN', 'WEB_FORM', 'REFERRAL', 'OTHER']);
    expect(['Not interested', 'Converted', 'Uncontacted', 'Follow up', 'Hot', 'Meeting fixed', '???'].map(status)).toEqual(['LOST', 'WON', 'NEW', 'CONTACTED', 'QUALIFIED', 'CONSULT_BOOKED', null]);
  });
});

describe('rows', () => {
  const opts = { country: 'IN', dateOrder: 'DMY' as const };
  const m = guessMapping('leads', ['Name', 'Mobile', 'Email', 'Status', 'Visa', 'Enquiry date']);
  it('cleans a good row', () => {
    const r = cleanRow('leads', ['Priya Sharma', "'098400 12345", 'PRIYA@Mail.com ', 'Follow up', 'Study', '01/02/2026'], m, opts);
    expect(r).toMatchObject({ ok: true, warnings: [], data: { firstName: 'Priya', lastName: 'Sharma', phoneNormalized: '+919840012345', email: 'priya@mail.com', status: 'CONTACTED', interestCategory: 'STUDY', source: 'OTHER' } });
    expect(r.ok && iso(r.data.createdAt)).toBe('2026-02-01');
  });
  it('explains rows it cannot import, and keeps going with warnings', () => {
    expect(cleanRow('leads', ['', '', '', '', '', ''], m, opts)).toEqual({ ok: false, error: 'No name' });
    expect(cleanRow('leads', ['Ravi', '', '', '', '', ''], m, opts)).toEqual({ ok: false, error: 'No phone or email' });
    expect(cleanRow('leads', ['Ravi', 'abc', '', '', '', ''], m, opts)).toMatchObject({ ok: false });
    const r = cleanRow('leads', ['Ravi', '9840011111', 'not-an-email', 'Maybe', '', 'someday'], m, opts);
    expect(r.ok && r.warnings).toEqual(["Email “not-an-email” isn't valid, left out", 'Enquiry date “someday” isn\'t a date, left out', 'Status “Maybe” not recognised, set to New']);
  });
  it('uses the email as a name when there is no name', () => {
    const r = cleanRow('leads', ['', '', 'anu.k@mail.com', '', '', ''], m, opts);
    expect(r.ok && r.data.firstName).toBe('anu.k');
  });
  it('sample files round-trip through the guesser', () => {
    for (const e of ['leads', 'clients'] as const) {
      const [head] = sampleCsv(e).split('\n');
      const g = guessMapping(e, head!.split(','));
      expect(Object.values(g).filter((v) => v >= 0)).toHaveLength(head!.split(',').length);
    }
  });
});
