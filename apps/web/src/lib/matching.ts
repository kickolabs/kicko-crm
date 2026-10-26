// Match applicants to an opening (a vacancy, in the immigration pack). Pure and
// industry-neutral: an opening lists what it needs, a candidate's profile what they have.
// The score is a guide for the consultant, never an eligibility decision; an occupation
// the library marks "not eligible" for the opening's route is excluded with the reason.

export type OpeningNeeds = {
  occupation?: string | null;
  /** Occupation group of `occupation` (e.g. 'drivers'), for near matches. */
  occupationGroup?: string | null;
  country?: string | null;
  minExperience?: number | null;
  /** Licence categories that must be held, e.g. ['HMV']. */
  licences?: string[];
  qualification?: string | null;
};

export type CandidateProfile = {
  occupation?: string | null;
  occupationGroup?: string | null;
  experienceYears?: number | null;
  licences?: { kind?: string; category?: string; expires?: string }[];
  preferredCountries?: string[];
  qualification?: string | null;
};

export type Eligibility = { group: string; eligibility: string; note?: string }[];

/** Qualification ladder, lowest first; values outside it count as unknown. */
export const QUALIFICATIONS = ['10th', '12th', 'ITI / trade certificate', 'Diploma', "Bachelor's", "Master's", 'PhD'];

export type Match = { score: number; reasons: string[]; gaps: string[]; excluded: string | null };

export function matchCandidate(o: OpeningNeeds, c: CandidateProfile, eligibility: Eligibility = [], today = new Date()): Match {
  const reasons: string[] = [];
  const gaps: string[] = [];
  const rule = c.occupationGroup ? eligibility.find((e) => e.group === c.occupationGroup) : undefined;
  if (rule?.eligibility === 'not_eligible') {
    return { score: 0, reasons, gaps, excluded: `This route is not open to ${c.occupationGroup?.replace(/_/g, ' ')} workers${rule.note ? `: ${rule.note}` : ''}` };
  }
  let score = 0;
  // Occupation: 40 for the same one, 20 for the same group.
  if (o.occupation && c.occupation === o.occupation) {
    score += 40;
    reasons.push('Same occupation');
  } else if (o.occupationGroup && c.occupationGroup === o.occupationGroup) {
    score += 20;
    reasons.push('Related occupation');
  } else if (o.occupation) gaps.push('Different occupation');
  // Experience: 20, scaled when short.
  const need = o.minExperience ?? 0;
  const have = c.experienceYears ?? 0;
  if (!need || have >= need) {
    score += 20;
    if (need) reasons.push(`${have} years' experience (needs ${need})`);
  } else {
    score += Math.round((20 * have) / need);
    gaps.push(`${have} of ${need} years' experience`);
  }
  // Licences: 15 when every required category is held and still valid.
  if (o.licences?.length) {
    const held = (c.licences ?? []).filter((l) => !l.expires || new Date(`${l.expires}T23:59:59Z`) >= today).map((l) => (l.category ?? '').toUpperCase());
    const missing = o.licences.filter((need) => !held.some((h) => h.includes(need.toUpperCase())));
    if (!missing.length) {
      score += 15;
      reasons.push('Holds the licences needed');
    } else gaps.push(`Needs licence: ${missing.join(', ')}`);
  } else score += 15;
  // Destination: 10 when the country is one they want.
  if (o.country && c.preferredCountries?.includes(o.country)) {
    score += 10;
    reasons.push('Wants this country');
  } else if (!o.country) score += 10;
  // Qualification: 10 when at or above what's needed.
  const needQ = o.qualification ? QUALIFICATIONS.indexOf(o.qualification) : -1;
  const haveQ = c.qualification ? QUALIFICATIONS.indexOf(c.qualification) : -1;
  if (needQ < 0 || haveQ >= needQ) score += 10;
  else gaps.push(`Needs ${o.qualification}`);
  // A conditional route still counts; the consultant sees why.
  if (rule?.eligibility === 'conditional') gaps.push(`Conditional${rule.note ? `: ${rule.note}` : ''}`);
  score += 5; // base: on the agency's books
  return { score: Math.min(100, score), reasons, gaps, excluded: null };
}
