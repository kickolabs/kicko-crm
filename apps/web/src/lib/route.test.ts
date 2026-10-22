import { describe, expect, it } from 'vitest';
import { findCity, routeFor } from './route';

describe('journey route line', () => {
  it('names both ends with airport codes and the distance', () => {
    expect(routeFor({ fromCity: 'Chennai', toCity: null, toCountry: 'CA', countryName: 'Canada' })).toEqual({ from: 'Chennai MAA', to: 'Toronto YYZ', km: 13390 });
    expect(routeFor({ fromCity: 'Bangalore', toCity: 'Melbourne', toCountry: 'AU', countryName: 'Australia' }).to).toBe('Melbourne MEL');
  });

  it('matches old and local names, and ignores the rest of an address', () => {
    expect(findCity('Madras')?.code).toBe('MAA');
    expect(findCity('Gurugram, Haryana')?.code).toBe('DEL');
    expect(findCity('Atlantis')).toBeNull();
  });

  it('never guesses: unknown cities show by name, without a distance', () => {
    expect(routeFor({ fromCity: 'Salem', toCity: 'Halifax', toCountry: 'CA', countryName: 'Canada' })).toEqual({ from: 'Salem', to: 'Halifax', km: null });
    expect(routeFor({ fromCity: null, toCity: null, toCountry: 'EU', countryName: 'Europe (Schengen)' })).toEqual({ from: null, to: 'Europe (Schengen)', km: null });
  });
});
