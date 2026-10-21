// Test scores → Canadian Language Benchmark (CLB) and Australian English levels.
// Pure functions: used live in the browser and again on the server when saving.

export type Bands = { l: number; r: number; w: number; s: number };
export const ABILITIES = ['l', 'r', 'w', 's'] as const;

/** IELTS General Training band per ability → CLB (IRCC equivalency table). */
const IELTS_GT: Record<keyof Bands, [number, number][]> = {
  l: [[8.5, 10], [8, 9], [7.5, 8], [6, 7], [5.5, 6], [5, 5], [4.5, 4]],
  r: [[8, 10], [7, 9], [6.5, 8], [6, 7], [5, 6], [4, 5], [3.5, 4]],
  w: [[7.5, 10], [7, 9], [6.5, 8], [6, 7], [5.5, 6], [5, 5], [4, 4]],
  s: [[7.5, 10], [7, 9], [6.5, 8], [6, 7], [5.5, 6], [5, 5], [4, 4]],
};

export function ieltsToClb(b: Bands): Bands {
  const one = (k: keyof Bands) => IELTS_GT[k].find(([min]) => b[k] >= min)?.[1] ?? 0;
  return { l: one('l'), r: one('r'), w: one('w'), s: one('s') };
}

/** CELPIP-General level equals the CLB level (capped at 10). */
export function celpipToClb(b: Bands): Bands {
  const one = (v: number) => (v >= 10 ? 10 : v >= 4 ? Math.floor(v) : 0);
  return { l: one(b.l), r: one(b.r), w: one(b.w), s: one(b.s) };
}

export const minBand = (b: Bands) => Math.min(b.l, b.r, b.w, b.s);
export const allAtLeast = (b: Bands, clb: number) => minBand(b) >= clb;

export type AuEnglish = 'none' | 'competent' | 'proficient' | 'superior';

/** IELTS (Academic or General) per-band minimums used by the Australian points test. */
export function ieltsToAuEnglish(b: Bands): AuEnglish {
  const m = minBand(b);
  return m >= 8 ? 'superior' : m >= 7 ? 'proficient' : m >= 6 ? 'competent' : 'none';
}
