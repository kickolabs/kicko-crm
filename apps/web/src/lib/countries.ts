// Country names from ISO codes, on the server and in the browser, with no list in our code:
// the platform's own region names (Intl), plus the few groupings the library adds. Which
// countries to offer comes from the industry pack's library (server/library.ts).

const display = new Intl.DisplayNames(['en'], { type: 'region' });
const GROUPS: Record<string, string> = { EU: 'Schengen Area', XK: 'Kosovo' };

export function countryName(code: string | null | undefined): string {
  if (!code) return '';
  const c = code.toUpperCase();
  if (GROUPS[c]) return GROUPS[c];
  if (!/^[A-Z]{2}$/.test(c)) return code;
  try {
    const n = display.of(c);
    return n && n !== c ? n : code;
  } catch {
    return code;
  }
}

let byName: Map<string, string> | null = null;

/** ISO code for a country written as a code or a name ("ca", "Canada", "UK"), else null. */
export function countryCode(input: string | null | undefined): string | null {
  const s = input?.trim();
  if (!s) return null;
  if (/^[a-z]{2}$/i.test(s) && countryName(s) !== s) return s.toUpperCase();
  if (!byName) {
    byName = new Map(Object.entries(GROUPS).map(([c, n]) => [n.toLowerCase(), c]));
    const A = 65;
    for (let i = 0; i < 26; i++)
      for (let j = 0; j < 26; j++) {
        const c = String.fromCharCode(A + i, A + j);
        const n = countryName(c);
        if (n !== c && !/unknown/i.test(n)) byName.set(n.toLowerCase(), c);
      }
    for (const [alias, c] of Object.entries(ALIASES)) byName.set(alias, c);
  }
  return byName.get(s.toLowerCase().replace(/\s+/g, ' ')) ?? null;
}

// Everyday names people type that differ from the official short name.
const ALIASES: Record<string, string> = {
  uk: 'GB', 'great britain': 'GB', britain: 'GB', england: 'GB', usa: 'US', us: 'US', america: 'US', 'united states of america': 'US',
  uae: 'AE', emirates: 'AE', dubai: 'AE', ksa: 'SA', 'saudi': 'SA', schengen: 'EU', europe: 'EU', 'south korea': 'KR', korea: 'KR',
  russia: 'RU', 'czech republic': 'CZ', holland: 'NL', 'new zealand': 'NZ', nz: 'NZ', oz: 'AU',
};

const SPOKEN: Record<string, string> = { GB: 'the UK', US: 'the US', AE: 'the UAE', NL: 'the Netherlands', PH: 'the Philippines', CZ: 'Czechia', EU: 'the Schengen Area' };

/** A country as said in a sentence: "go to the UK", "study in Canada". */
export function spokenCountry(code: string | null | undefined): string {
  if (!code) return '';
  const c = code.toUpperCase();
  if (SPOKEN[c]) return SPOKEN[c];
  const n = countryName(c);
  return /^(United |Republic |Democratic |Central African|Dominican Republic|Gambia|Maldives|Bahamas|Marshall|Solomon|Comoros|Seychelles)/.test(n) ? `the ${n}` : n;
}
