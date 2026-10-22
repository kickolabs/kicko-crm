import { describe, expect, it } from 'vitest';
import { scrub } from './feedback';

describe('feedback anonymiser', () => {
  it('removes names, quoted values, ids, numbers, dates, emails and phones', () => {
    const out = scrub('Name on the document ("Priya Ramanathan") doesn\'t match the client. Passport Z1234567, born 1999-04-12, call +91 98400 11223 or priya@example.com. Paid 35000.', ['Priya', 'Raman']);
    expect(out).toBe('Name on the document ("[value]") doesn\'t match the client. Passport [id], born [date], call [phone] or [email]. Paid [number].');
  });

  it('matches names whole-word and case-insensitively', () => {
    expect(scrub('PRIYA asked; Priyanka did not', ['Priya'])).toBe('[name] asked; Priyanka did not');
  });

  it('keeps the useful shape of an issue', () => {
    expect(scrub('Expires 14 Mar 2031: under 6 months away, and many visas need 6+ months of validity.')).toBe(
      'Expires [date]: under 6 months away, and many visas need 6+ months of validity.',
    );
  });
});
