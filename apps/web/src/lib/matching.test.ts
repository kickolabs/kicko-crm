import { describe, expect, it } from 'vitest';
import { matchCandidate } from './matching';

const truckJob = { occupation: 'truck_driver', occupationGroup: 'drivers', country: 'AE', minExperience: 3, licences: ['HMV'], qualification: '10th' };
const today = new Date('2026-10-26T00:00:00Z');

describe('candidate matching', () => {
  it('scores a strong match high and explains why', () => {
    const m = matchCandidate(truckJob, {
      occupation: 'truck_driver', occupationGroup: 'drivers', experienceYears: 6,
      licences: [{ kind: 'Driving licence', category: 'HMV', expires: '2030-01-01' }], preferredCountries: ['AE'], qualification: '12th',
    }, [], today);
    expect(m.score).toBe(100);
    expect(m.reasons).toContain('Same occupation');
    expect(m.gaps).toEqual([]);
  });

  it('lists the gaps of a weaker match', () => {
    const m = matchCandidate(truckJob, { occupation: 'bus_driver', occupationGroup: 'drivers', experienceYears: 1, licences: [{ category: 'HMV', expires: '2025-01-01' }] }, [], today);
    expect(m.score).toBeLessThan(60);
    expect(m.reasons).toContain('Related occupation');
    expect(m.gaps).toEqual(expect.arrayContaining(['1 of 3 years\' experience', 'Needs licence: HMV']));
  });

  it('excludes occupations the route does not admit, with the reason', () => {
    const m = matchCandidate({ ...truckJob, occupation: null }, { occupationGroup: 'hospitality' }, [{ group: 'hospitality', eligibility: 'not_eligible', note: 'shortage list only' }], today);
    expect(m.excluded).toBe('This route is not open to hospitality workers: shortage list only');
    expect(m.score).toBe(0);
  });

  it('keeps conditional routes but flags them', () => {
    const m = matchCandidate({}, { occupationGroup: 'healthcare' }, [{ group: 'healthcare', eligibility: 'conditional', note: 'recognition needed' }], today);
    expect(m.excluded).toBeNull();
    expect(m.gaps).toContain('Conditional: recognition needed');
  });
});
