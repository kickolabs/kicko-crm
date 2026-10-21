import { allAtLeast, type Bands } from './language';

// Canada Express Entry: Comprehensive Ranking System (CRS), out of 1,200.
// Tables from IRCC's published criteria. Since 25 March 2025, arranged employment
// no longer earns points, so it isn't scored here.

export type Education = 'none' | 'secondary' | 'one_year' | 'two_year' | 'bachelor' | 'two_or_more' | 'master' | 'doctoral';

export const EDUCATION_LABEL: Record<Education, string> = {
  none: 'Less than secondary school',
  secondary: 'Secondary school (12th)',
  one_year: 'One-year post-secondary diploma',
  two_year: 'Two-year post-secondary diploma',
  bachelor: "Bachelor's degree (or 3+ year program)",
  two_or_more: 'Two or more credentials, one 3+ years',
  master: "Master's or professional degree",
  doctoral: 'Doctoral degree (PhD)',
};

export type CrsInput = {
  age: number;
  /** Spouse or partner coming to Canada (and not a Canadian citizen or PR). */
  spouse: boolean;
  education: Education;
  /** First official language, as CLB (English) or NCLC (French) per ability. */
  first: Bands;
  firstIsFrench: boolean;
  /** Second official language, or null. */
  second: Bands | null;
  canadianWork: number; // years, skilled
  foreignWork: number; // years, skilled
  certificate: boolean; // certificate of qualification in a trade
  spouseEducation: Education;
  spouseLanguage: Bands | null; // CLB
  spouseCanadianWork: number;
  provincialNomination: boolean;
  canadianEducation: 'none' | 'one_two' | 'three_plus';
  sibling: boolean; // brother or sister in Canada (citizen or PR)
};

export const CRS_DEFAULTS: CrsInput = {
  age: 29, spouse: false, education: 'bachelor', first: { l: 7, r: 7, w: 7, s: 7 }, firstIsFrench: false, second: null,
  canadianWork: 0, foreignWork: 0, certificate: false, spouseEducation: 'none', spouseLanguage: null, spouseCanadianWork: 0,
  provincialNomination: false, canadianEducation: 'none', sibling: false,
};

export type Line = { label: string; points: number; max: number };
export type CrsResult = { total: number; sections: { title: string; points: number; max: number; lines: Line[] }[] };

// [single, with spouse]
const AGE: Record<number, [number, number]> = {
  18: [99, 90], 19: [105, 95], 20: [110, 100], 21: [110, 100], 22: [110, 100], 23: [110, 100], 24: [110, 100], 25: [110, 100], 26: [110, 100],
  27: [110, 100], 28: [110, 100], 29: [110, 100], 30: [105, 95], 31: [99, 90], 32: [94, 85], 33: [88, 80], 34: [83, 75], 35: [77, 70],
  36: [72, 65], 37: [66, 60], 38: [61, 55], 39: [55, 50], 40: [50, 45], 41: [39, 35], 42: [28, 25], 43: [17, 15], 44: [6, 5],
};
const EDU: Record<Education, [number, number]> = {
  none: [0, 0], secondary: [30, 28], one_year: [90, 84], two_year: [98, 91], bachelor: [120, 112], two_or_more: [128, 119], master: [135, 126], doctoral: [150, 140],
};
const SPOUSE_EDU: Record<Education, number> = { none: 0, secondary: 2, one_year: 6, two_year: 7, bachelor: 8, two_or_more: 9, master: 10, doctoral: 10 };
const CDN_WORK: [number, number][] = [[0, 0], [40, 35], [53, 46], [64, 56], [72, 63], [80, 70]]; // by years 0..5+
const SPOUSE_CDN_WORK = [0, 5, 7, 8, 9, 10];

function firstLangPerAbility(clb: number, spouse: boolean) {
  const t: [number, number][] = [[10, spouse ? 32 : 34], [9, spouse ? 29 : 31], [8, spouse ? 22 : 23], [7, spouse ? 16 : 17], [6, spouse ? 8 : 9], [4, 6]];
  return t.find(([min]) => clb >= min)?.[1] ?? 0;
}
const secondLangPerAbility = (clb: number) => (clb >= 9 ? 6 : clb >= 7 ? 3 : clb >= 5 ? 1 : 0);
const spouseLangPerAbility = (clb: number) => (clb >= 9 ? 5 : clb >= 7 ? 3 : clb >= 5 ? 1 : 0);
const sum4 = (b: Bands, f: (v: number) => number) => f(b.l) + f(b.r) + f(b.w) + f(b.s);
const yearsIdx = (y: number) => Math.max(0, Math.min(5, Math.floor(y)));

export function crs(i: CrsInput): CrsResult {
  const sp = i.spouse ? 1 : 0;

  // A. Core / human capital
  const age = AGE[Math.floor(i.age)]?.[sp] ?? 0;
  const edu = EDU[i.education][sp];
  const lang1 = sum4(i.first, (v) => firstLangPerAbility(v, i.spouse));
  const lang2 = i.second ? Math.min(i.spouse ? 22 : 24, sum4(i.second, secondLangPerAbility)) : 0;
  const cdn = CDN_WORK[yearsIdx(i.canadianWork)]![sp];
  const core = age + edu + lang1 + lang2 + cdn;

  // B. Spouse factors
  const sEdu = i.spouse ? SPOUSE_EDU[i.spouseEducation] : 0;
  const sLang = i.spouse && i.spouseLanguage ? Math.min(20, sum4(i.spouseLanguage, spouseLangPerAbility)) : 0;
  const sWork = i.spouse ? SPOUSE_CDN_WORK[yearsIdx(i.spouseCanadianWork)]! : 0;

  // C. Skill transferability (max 100)
  const langTier = allAtLeast(i.first, 9) ? 2 : allAtLeast(i.first, 7) ? 1 : 0;
  const eduTier = ['two_or_more', 'master', 'doctoral'].includes(i.education) ? 2 : ['one_year', 'two_year', 'bachelor'].includes(i.education) ? 1 : 0;
  const cdnTier = i.canadianWork >= 2 ? 2 : i.canadianWork >= 1 ? 1 : 0;
  const fwTier = i.foreignWork >= 3 ? 2 : i.foreignWork >= 1 ? 1 : 0;
  const grid = (a: number, b: number) => (!a || !b ? 0 : a === 2 && b === 2 ? 50 : a === 2 || b === 2 ? 25 : 13);
  const eduLang = grid(eduTier, langTier);
  const eduCdn = grid(eduTier, cdnTier);
  const fwLang = grid(fwTier, langTier);
  const fwCdn = grid(fwTier, cdnTier);
  const certLang = i.certificate ? (allAtLeast(i.first, 7) ? 50 : allAtLeast(i.first, 5) ? 25 : 0) : 0;
  const eduGroup = Math.min(50, eduLang + eduCdn);
  const fwGroup = Math.min(50, fwLang + fwCdn);
  const transfer = Math.min(100, eduGroup + fwGroup + certLang);

  // D. Additional points (max 600)
  const french = i.firstIsFrench ? i.first : i.second;
  const english = i.firstIsFrench ? i.second : i.first;
  const frenchPts = french && allAtLeast(french, 7) ? (english && allAtLeast(english, 5) ? 50 : 25) : 0;
  const pnp = i.provincialNomination ? 600 : 0;
  const study = i.canadianEducation === 'three_plus' ? 30 : i.canadianEducation === 'one_two' ? 15 : 0;
  const sibling = i.sibling ? 15 : 0;
  const additional = Math.min(600, pnp + study + frenchPts + sibling);

  const sections = [
    {
      title: 'Core: age, education, language, Canadian work',
      points: core,
      max: i.spouse ? 460 : 500,
      lines: [
        { label: 'Age', points: age, max: i.spouse ? 100 : 110 },
        { label: 'Education', points: edu, max: i.spouse ? 140 : 150 },
        { label: 'First official language', points: lang1, max: i.spouse ? 128 : 136 },
        { label: 'Second official language', points: lang2, max: i.spouse ? 22 : 24 },
        { label: 'Canadian work experience', points: cdn, max: i.spouse ? 70 : 80 },
      ],
    },
    ...(i.spouse
      ? [{
          title: 'Spouse or partner',
          points: sEdu + sLang + sWork,
          max: 40,
          lines: [
            { label: 'Spouse education', points: sEdu, max: 10 },
            { label: 'Spouse language', points: sLang, max: 20 },
            { label: 'Spouse Canadian work', points: sWork, max: 10 },
          ],
        }]
      : []),
    {
      title: 'Skill transferability',
      points: transfer,
      max: 100,
      lines: [
        { label: 'Education + language', points: eduLang, max: 50 },
        { label: 'Education + Canadian work', points: eduCdn, max: 50 },
        { label: 'Foreign work + language', points: fwLang, max: 50 },
        { label: 'Foreign work + Canadian work', points: fwCdn, max: 50 },
        { label: 'Trade certificate + language', points: certLang, max: 50 },
      ],
    },
    {
      title: 'Additional points',
      points: additional,
      max: 600,
      lines: [
        { label: 'Provincial nomination', points: pnp, max: 600 },
        { label: 'Study in Canada', points: study, max: 30 },
        { label: 'French language', points: frenchPts, max: 50 },
        { label: 'Sibling in Canada', points: sibling, max: 15 },
      ],
    },
  ];
  return { total: core + sEdu + sLang + sWork + transfer + additional, sections };
}

/** Realistic changes and what each would add, best first. Pure code, no AI. */
export function crsWhatIfs(i: CrsInput) {
  const base = crs(i).total;
  const all = (v: number): Bands => ({ l: v, r: v, w: v, s: v });
  const lift = (b: Bands, v: number): Bands => ({ l: Math.max(b.l, v), r: Math.max(b.r, v), w: Math.max(b.w, v), s: Math.max(b.s, v) });
  const options: { change: string; input: CrsInput }[] = [
    { change: 'Reach CLB 9 in all four English skills (IELTS 8 / 7 / 7 / 7)', input: { ...i, first: lift(i.first, 9) } },
    { change: 'Reach CLB 10 in all four skills', input: { ...i, first: lift(i.first, 10) } },
    { change: 'Learn French to NCLC 7 in all skills', input: i.firstIsFrench ? i : { ...i, second: lift(i.second ?? all(0), 7) } },
    { change: 'One more year of Canadian work experience', input: { ...i, canadianWork: i.canadianWork + 1 } },
    { change: 'A master\'s degree', input: { ...i, education: ['master', 'doctoral'].includes(i.education) ? i.education : 'master' } },
    { change: 'Study in Canada (2-year program)', input: { ...i, canadianEducation: i.canadianEducation === 'none' ? 'one_two' : i.canadianEducation } },
    ...(i.spouse ? [{ change: 'Spouse takes IELTS and reaches CLB 7', input: { ...i, spouseLanguage: lift(i.spouseLanguage ?? all(0), 7) } }] : []),
    { change: 'Provincial nomination (PNP)', input: { ...i, provincialNomination: true } },
  ];
  return options
    .map((o) => ({ change: o.change, points: crs(o.input).total - base }))
    .filter((o) => o.points > 0)
    .sort((a, b) => b.points - a.points);
}
