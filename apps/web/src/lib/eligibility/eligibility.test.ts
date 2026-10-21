import { describe, expect, it } from 'vitest';
import { auPoints, auWhatIfs, AU_DEFAULTS } from './au';
import { crs, crsWhatIfs, CRS_DEFAULTS, type CrsInput } from './crs';
import { celpipToClb, ieltsToAuEnglish, ieltsToClb } from './language';

const all = (v: number) => ({ l: v, r: v, w: v, s: v });

describe('language conversion', () => {
  it('maps IELTS General Training bands to CLB per ability', () => {
    expect(ieltsToClb({ l: 8, r: 7, w: 7, s: 7 })).toEqual(all(9));
    expect(ieltsToClb({ l: 8.5, r: 8, w: 7.5, s: 7.5 })).toEqual(all(10));
    expect(ieltsToClb({ l: 6, r: 6, w: 6, s: 6 })).toEqual(all(7));
    expect(ieltsToClb({ l: 7.5, r: 6.5, w: 6.5, s: 6.5 })).toEqual(all(8));
    expect(ieltsToClb({ l: 4, r: 3, w: 3.5, s: 3.5 })).toEqual(all(0));
  });
  it('CELPIP level equals CLB, capped at 10', () => {
    expect(celpipToClb({ l: 12, r: 9, w: 7, s: 3 })).toEqual({ l: 10, r: 9, w: 7, s: 0 });
  });
  it('maps IELTS to Australian English levels on the lowest band', () => {
    expect(ieltsToAuEnglish({ l: 8.5, r: 8, w: 8, s: 8 })).toBe('superior');
    expect(ieltsToAuEnglish({ l: 8, r: 7, w: 7.5, s: 7 })).toBe('proficient');
    expect(ieltsToAuEnglish({ l: 7, r: 6, w: 6.5, s: 7 })).toBe('competent');
    expect(ieltsToAuEnglish({ l: 7, r: 5.5, w: 7, s: 7 })).toBe('none');
  });
});

describe('Canada CRS (worked examples from the IRCC tables)', () => {
  it('single, 29, master\'s, CLB 9, 3 years foreign work → 469', () => {
    const r = crs({ ...CRS_DEFAULTS, age: 29, education: 'master', first: all(9), foreignWork: 3 });
    // Core: age 110 + education 135 + language 4×31 = 369. Transferability: 50 + 50.
    expect(r.total).toBe(469);
    expect(r.sections.find((s) => s.title === 'Skill transferability')!.points).toBe(100);
  });

  it('with spouse, 32, bachelor\'s, CLB 8, 1 year Canadian + 2 years foreign work → 392', () => {
    const input: CrsInput = {
      ...CRS_DEFAULTS, age: 32, spouse: true, education: 'bachelor', first: all(8), canadianWork: 1, foreignWork: 2,
      spouseEducation: 'bachelor', spouseLanguage: all(7),
    };
    // Core 85 + 112 + 4×22 + 35 = 320; spouse 8 + 4×3 = 20; transferability 13+13 + 13+13 = 52.
    expect(crs(input).total).toBe(392);
  });

  it('caps transferability at 100 and additional points at 600', () => {
    const r = crs({ ...CRS_DEFAULTS, age: 25, education: 'doctoral', first: all(10), canadianWork: 3, foreignWork: 5, certificate: true, provincialNomination: true, canadianEducation: 'three_plus', sibling: true });
    expect(r.sections.find((s) => s.title === 'Skill transferability')!.points).toBe(100);
    expect(r.sections.find((s) => s.title === 'Additional points')!.points).toBe(600);
  });

  it('French bonus: NCLC 7 with English CLB 5+ gives 50, otherwise 25', () => {
    const base = { ...CRS_DEFAULTS, first: all(7) };
    const withFrench = crs({ ...base, second: all(7) }).sections.find((s) => s.title === 'Additional points')!;
    expect(withFrench.lines.find((l) => l.label === 'French language')!.points).toBe(50);
    const frenchFirstWeakEnglish = crs({ ...base, firstIsFrench: true, second: all(4) }).sections.find((s) => s.title === 'Additional points')!;
    expect(frenchFirstWeakEnglish.lines.find((l) => l.label === 'French language')!.points).toBe(25);
  });

  it('age points fall to zero at 45', () => {
    expect(crs({ ...CRS_DEFAULTS, age: 45 }).sections[0]!.lines[0]!.points).toBe(0);
    expect(crs({ ...CRS_DEFAULTS, age: 44 }).sections[0]!.lines[0]!.points).toBe(6);
  });

  it('what-ifs are real recalculations, best first', () => {
    const w = crsWhatIfs({ ...CRS_DEFAULTS, age: 29, education: 'bachelor', first: all(7) });
    expect(w[0]).toEqual({ change: 'Provincial nomination (PNP)', points: 600 });
    expect(w.find((x) => x.change.startsWith('Reach CLB 9'))!.points).toBe(crs({ ...CRS_DEFAULTS, education: 'bachelor', first: all(9) }).total - crs({ ...CRS_DEFAULTS, education: 'bachelor', first: all(7) }).total);
    expect(w.every((x, i) => i === 0 || w[i - 1]!.points >= x.points)).toBe(true);
  });
});

describe('Australia points test', () => {
  it('31, superior English, 6 years overseas, bachelor\'s, single → 85; with 190 nomination → 90', () => {
    const i = { ...AU_DEFAULTS, age: 31, english: 'superior' as const, overseasWork: 6, education: 'bachelor' as const, partner: 'single' as const };
    expect(auPoints(i)).toMatchObject({ total: 85, passes: true });
    expect(auPoints({ ...i, nomination: '190' }).total).toBe(90);
  });
  it('caps combined work points at 20', () => {
    expect(auPoints({ ...AU_DEFAULTS, overseasWork: 9, australianWork: 9 }).lines.find((l) => l.label.startsWith('Skilled work'))!.points).toBe(20);
  });
  it('blocks applicants aged 45+ or without Competent English even with enough points', () => {
    const r = auPoints({ ...AU_DEFAULTS, age: 46, english: 'superior', overseasWork: 9, education: 'doctorate', nomination: '491' });
    expect(r.passes).toBe(false);
    expect(r.blockers).toContain('Must be under 45 when invited');
    expect(auPoints({ ...AU_DEFAULTS, english: 'none' }).blockers).toHaveLength(1);
  });
  it('what-ifs suggest English first when it helps most', () => {
    const w = auWhatIfs({ ...AU_DEFAULTS, english: 'competent' });
    expect(w[0]).toEqual({ change: 'Superior English (IELTS 8 in each band)', points: 20 });
  });
});
