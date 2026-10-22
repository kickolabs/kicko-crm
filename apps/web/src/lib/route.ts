// The case journey's route line: "CHENNAI MAA · 13,420 KM · TORONTO YYZ".
// A small built-in table of cities agencies send clients from and to. A city
// that isn't listed just shows its name, with no airport code or distance, so
// the line is never wrong.

type City = { name: string; code: string; lat: number; lng: number; aliases?: string[] };

const CITIES: City[] = [
  // India
  { name: 'Chennai', code: 'MAA', lat: 12.99, lng: 80.17, aliases: ['madras'] },
  { name: 'Coimbatore', code: 'CJB', lat: 11.03, lng: 77.04 },
  { name: 'Bengaluru', code: 'BLR', lat: 13.2, lng: 77.71, aliases: ['bangalore'] },
  { name: 'Hyderabad', code: 'HYD', lat: 17.24, lng: 78.43, aliases: ['secunderabad'] },
  { name: 'Mumbai', code: 'BOM', lat: 19.09, lng: 72.87, aliases: ['bombay', 'navi mumbai', 'thane'] },
  { name: 'Delhi', code: 'DEL', lat: 28.56, lng: 77.1, aliases: ['new delhi', 'noida', 'gurgaon', 'gurugram'] },
  { name: 'Kolkata', code: 'CCU', lat: 22.65, lng: 88.45, aliases: ['calcutta'] },
  { name: 'Kochi', code: 'COK', lat: 10.15, lng: 76.4, aliases: ['cochin', 'ernakulam'] },
  { name: 'Thiruvananthapuram', code: 'TRV', lat: 8.48, lng: 76.92, aliases: ['trivandrum'] },
  { name: 'Madurai', code: 'IXM', lat: 9.83, lng: 78.09 },
  { name: 'Tiruchirappalli', code: 'TRZ', lat: 10.77, lng: 78.71, aliases: ['trichy'] },
  { name: 'Ahmedabad', code: 'AMD', lat: 23.07, lng: 72.63 },
  { name: 'Pune', code: 'PNQ', lat: 18.58, lng: 73.92 },
  { name: 'Chandigarh', code: 'IXC', lat: 30.67, lng: 76.79, aliases: ['mohali'] },
  { name: 'Amritsar', code: 'ATQ', lat: 31.71, lng: 74.8 },
  { name: 'Jaipur', code: 'JAI', lat: 26.82, lng: 75.81 },
  { name: 'Lucknow', code: 'LKO', lat: 26.76, lng: 80.89 },
  { name: 'Visakhapatnam', code: 'VTZ', lat: 17.72, lng: 83.22, aliases: ['vizag'] },
  { name: 'Goa', code: 'GOI', lat: 15.38, lng: 73.83 },
  // Destinations
  { name: 'Toronto', code: 'YYZ', lat: 43.68, lng: -79.63 },
  { name: 'Vancouver', code: 'YVR', lat: 49.19, lng: -123.18 },
  { name: 'Montreal', code: 'YUL', lat: 45.47, lng: -73.74 },
  { name: 'Calgary', code: 'YYC', lat: 51.13, lng: -114.01 },
  { name: 'London', code: 'LHR', lat: 51.47, lng: -0.45 },
  { name: 'Manchester', code: 'MAN', lat: 53.35, lng: -2.27 },
  { name: 'Birmingham', code: 'BHX', lat: 52.45, lng: -1.75 },
  { name: 'Sydney', code: 'SYD', lat: -33.94, lng: 151.18 },
  { name: 'Melbourne', code: 'MEL', lat: -37.67, lng: 144.84 },
  { name: 'Brisbane', code: 'BNE', lat: -27.38, lng: 153.12 },
  { name: 'Perth', code: 'PER', lat: -31.94, lng: 115.97 },
  { name: 'Adelaide', code: 'ADL', lat: -34.95, lng: 138.53 },
  { name: 'New York', code: 'JFK', lat: 40.64, lng: -73.78 },
  { name: 'Boston', code: 'BOS', lat: 42.36, lng: -71.01 },
  { name: 'Chicago', code: 'ORD', lat: 41.97, lng: -87.9 },
  { name: 'San Francisco', code: 'SFO', lat: 37.62, lng: -122.38 },
  { name: 'Los Angeles', code: 'LAX', lat: 33.94, lng: -118.41 },
  { name: 'Dallas', code: 'DFW', lat: 32.9, lng: -97.04 },
  { name: 'Auckland', code: 'AKL', lat: -37.01, lng: 174.79 },
  { name: 'Wellington', code: 'WLG', lat: -41.33, lng: 174.81 },
  { name: 'Frankfurt', code: 'FRA', lat: 50.04, lng: 8.56 },
  { name: 'Berlin', code: 'BER', lat: 52.36, lng: 13.5 },
  { name: 'Munich', code: 'MUC', lat: 48.35, lng: 11.79 },
  { name: 'Dublin', code: 'DUB', lat: 53.42, lng: -6.27 },
  { name: 'Paris', code: 'CDG', lat: 49.01, lng: 2.55 },
  { name: 'Singapore', code: 'SIN', lat: 1.36, lng: 103.99 },
  { name: 'Dubai', code: 'DXB', lat: 25.25, lng: 55.36 },
];

/** Main arrival city when the case doesn't name one (e.g. no college yet). */
const COUNTRY_HUB: Record<string, string> = {
  CA: 'Toronto', AU: 'Sydney', GB: 'London', US: 'New York', NZ: 'Auckland', DE: 'Frankfurt', IE: 'Dublin', FR: 'Paris', SG: 'Singapore', AE: 'Dubai',
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

export function findCity(raw: string | null | undefined) {
  if (!raw) return null;
  const q = norm(raw.split(',')[0]!);
  return CITIES.find((c) => norm(c.name) === q || c.aliases?.includes(q)) ?? null;
}

function km(a: City, b: City) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return Math.round((2 * 6371 * Math.asin(Math.sqrt(h))) / 10) * 10;
}

export type Route = { from: string | null; to: string; km: number | null };

/** From the branch's city to the college's city, else the country's main hub, else the country. */
export function routeFor(input: { fromCity?: string | null; toCity?: string | null; toCountry: string; countryName: string }): Route {
  const from = findCity(input.fromCity);
  // The college's own city when we know it, even if it isn't in the table; the country's hub only without one.
  const to = input.toCity?.trim() ? findCity(input.toCity) : findCity(COUNTRY_HUB[input.toCountry]);
  return {
    from: from ? `${from.name} ${from.code}` : input.fromCity?.trim() || null,
    to: to ? `${to.name} ${to.code}` : input.toCity?.trim() || input.countryName,
    km: from && to ? km(from, to) : null,
  };
}
