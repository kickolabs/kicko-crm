import { describe, expect, it } from 'vitest';
import { findCity, routeFor } from './route';

describe('journey route line', () => {
  it('names both ends with airport codes and the distance', () => {
    expect(routeFor({ fromCity: 'Chennai', toCity: null, toCountry: 'CA', countryName: 'Canada' })).toEqual({ from: 'Chennai MAA', to: 'Toronto YYZ', km: 13390 });
    expect(routeFor({ fromCity: 'Bangalore', toCity: 'Melbourne', toCountry: 'AU', countryName: 'Australia' }).to).toBe('Melbourne MEL');
  });

  it('every destination country gets its main airport; an employer city wins', () => {
    const qa = routeFor({ fromCity: 'Coimbatore', toCity: null, toCountry: 'QA', countryName: 'Qatar' });
    expect(qa).toMatchObject({ from: 'Coimbatore CJB', to: 'Doha DOH' });
    expect(qa.km).toBeGreaterThan(2800);
    expect(qa.km).toBeLessThan(3200);
    expect(routeFor({ fromCity: 'Chennai', toCity: 'Jeddah', toCountry: 'SA', countryName: 'Saudi Arabia' }).to).toBe('Jeddah JED');
    expect(routeFor({ fromCity: null, toCity: null, toCountry: 'MY', countryName: 'Malaysia' }).to).toBe('Kuala Lumpur KUL');
  });

  it('the airport table has one valid entry per country', async () => {
    const { COUNTRY_AIRPORTS } = await import('./airports');
    expect(new Set(COUNTRY_AIRPORTS.map((a) => a.country)).size).toBe(COUNTRY_AIRPORTS.length);
    for (const a of COUNTRY_AIRPORTS) {
      expect(a.code, a.country).toMatch(/^[A-Z]{3}$/);
      expect(Math.abs(a.lat) <= 90 && Math.abs(a.lng) <= 180, a.country).toBe(true);
    }
    expect(COUNTRY_AIRPORTS.length).toBeGreaterThan(185);
  });

  it('matches old and local names, and ignores the rest of an address', () => {
    expect(findCity('Madras')?.code).toBe('MAA');
    expect(findCity('Gurugram, Haryana')?.code).toBe('DEL');
    expect(findCity('Atlantis')).toBeNull();
    expect(findCity('Sao Paulo')?.code).toBe('GRU'); // accents optional
  });

  it('never guesses: unknown cities show by name, without a distance', () => {
    expect(routeFor({ fromCity: 'Salem', toCity: 'Halifax', toCountry: 'CA', countryName: 'Canada' })).toEqual({ from: 'Salem', to: 'Halifax', km: null });
    expect(routeFor({ fromCity: null, toCity: null, toCountry: 'EU', countryName: 'Europe (Schengen)' })).toEqual({ from: null, to: 'Europe (Schengen)', km: null });
  });
});
