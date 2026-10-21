import type { AuEnglish } from './language';
import type { Line } from './crs';

// Australia: points test for skilled visas (subclass 189, 190, 491). Pass mark 65.
// Points per the Department of Home Affairs points table.

export type AuInput = {
  age: number;
  english: AuEnglish;
  overseasWork: number; // skilled years in the last 10
  australianWork: number; // skilled years in the last 10
  education: 'none' | 'diploma' | 'bachelor' | 'doctorate';
  specialistEducation: boolean; // Australian STEM master's by research or PhD
  australianStudy: boolean;
  regionalStudy: boolean;
  professionalYear: boolean;
  communityLanguage: boolean; // NAATI CCL
  partner: 'single' | 'skilled' | 'english' | 'none'; // single or AU citizen/PR partner | skilled partner | partner with competent English | neither
  nomination: 'none' | '190' | '491';
};

export const AU_DEFAULTS: AuInput = {
  age: 29, english: 'competent', overseasWork: 0, australianWork: 0, education: 'bachelor', specialistEducation: false,
  australianStudy: false, regionalStudy: false, professionalYear: false, communityLanguage: false, partner: 'single', nomination: 'none',
};

export const AU_PASS_MARK = 65;

export function auPoints(i: AuInput) {
  const a = Math.floor(i.age);
  const age = a >= 18 && a < 25 ? 25 : a >= 25 && a < 33 ? 30 : a >= 33 && a < 40 ? 25 : a >= 40 && a < 45 ? 15 : 0;
  const english = { none: 0, competent: 0, proficient: 10, superior: 20 }[i.english];
  const ow = i.overseasWork >= 8 ? 15 : i.overseasWork >= 5 ? 10 : i.overseasWork >= 3 ? 5 : 0;
  const aw = i.australianWork >= 8 ? 20 : i.australianWork >= 5 ? 15 : i.australianWork >= 3 ? 10 : i.australianWork >= 1 ? 5 : 0;
  const work = Math.min(20, ow + aw);
  const edu = { none: 0, diploma: 10, bachelor: 15, doctorate: 20 }[i.education];
  const partner = { single: 10, skilled: 10, english: 5, none: 0 }[i.partner];
  const nomination = { none: 0, '190': 5, '491': 15 }[i.nomination];
  const extras = [
    { label: 'Specialist education (Australian STEM research degree)', points: i.specialistEducation ? 10 : 0, max: 10 },
    { label: 'Australian study requirement', points: i.australianStudy ? 5 : 0, max: 5 },
    { label: 'Study in regional Australia', points: i.regionalStudy ? 5 : 0, max: 5 },
    { label: 'Professional Year', points: i.professionalYear ? 5 : 0, max: 5 },
    { label: 'Credentialled community language (NAATI)', points: i.communityLanguage ? 5 : 0, max: 5 },
  ];
  const lines: Line[] = [
    { label: 'Age', points: age, max: 30 },
    { label: 'English', points: english, max: 20 },
    { label: `Skilled work (overseas ${ow} + Australia ${aw}, capped at 20)`, points: work, max: 20 },
    { label: 'Education', points: edu, max: 20 },
    ...extras,
    { label: 'Partner', points: partner, max: 10 },
    { label: 'State or regional nomination', points: nomination, max: 15 },
  ];
  const total = lines.reduce((s, l) => s + l.points, 0);
  const blockers = [a < 18 || a >= 45 ? 'Must be under 45 when invited' : null, i.english === 'none' ? 'Needs at least Competent English (IELTS 6 in each band)' : null].filter(Boolean) as string[];
  return { total, passMark: AU_PASS_MARK, passes: total >= AU_PASS_MARK && !blockers.length, blockers, lines };
}

export function auWhatIfs(i: AuInput) {
  const base = auPoints(i).total;
  const options: { change: string; input: AuInput }[] = [
    { change: 'Proficient English (IELTS 7 in each band)', input: { ...i, english: i.english === 'superior' ? 'superior' : 'proficient' } },
    { change: 'Superior English (IELTS 8 in each band)', input: { ...i, english: 'superior' } },
    { change: 'State nomination (subclass 190)', input: { ...i, nomination: i.nomination === 'none' ? '190' : i.nomination } },
    { change: 'Regional nomination (subclass 491)', input: { ...i, nomination: '491' } },
    { change: 'NAATI community language credential', input: { ...i, communityLanguage: true } },
    { change: 'Professional Year in Australia', input: { ...i, professionalYear: true } },
    { change: 'Partner gets a skills assessment and Competent English', input: i.partner === 'english' || i.partner === 'none' ? { ...i, partner: 'skilled' } : i },
    { change: 'Partner reaches Competent English', input: i.partner === 'none' ? { ...i, partner: 'english' } : i },
  ];
  return options
    .map((o) => ({ change: o.change, points: auPoints(o.input).total - base }))
    .filter((o) => o.points > 0)
    .sort((a, b) => b.points - a.points);
}
