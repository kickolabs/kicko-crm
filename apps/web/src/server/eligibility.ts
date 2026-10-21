import 'server-only';
import type { Prisma } from '@kicko/db';
import { z } from 'zod';
import { auPoints, auWhatIfs, AU_DEFAULTS, type AuInput } from '@/lib/eligibility/au';
import { crs, crsWhatIfs, CRS_DEFAULTS, type CrsInput, type Education } from '@/lib/eligibility/crs';
import { celpipToClb, ieltsToAuEnglish, ieltsToClb, type Bands } from '@/lib/eligibility/language';
import { runStructured } from './ai/run';
import { inTenant, logActivity, UserError, type Scope } from './scope';

// Points calculators on a client: prefilled from the profile, computed by code
// (lib/eligibility), explained in plain words by the AI. The AI never sets a score.

type ClientRow = { dob: Date | null; maritalStatus: string | null; education: unknown; tests: unknown; work: unknown };

const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export function prefill(c: ClientRow, now = new Date()) {
  const notes: string[] = [];
  const crsIn: CrsInput = { ...CRS_DEFAULTS };
  const auIn: AuInput = { ...AU_DEFAULTS };

  if (c.dob) {
    const age = Math.floor((now.getTime() - c.dob.getTime()) / (365.25 * 86400_000));
    crsIn.age = age;
    auIn.age = age;
  } else notes.push('No date of birth on the profile: age set to 29.');

  const edu = ((c.education as { level?: string }[]) ?? []).map((e) => e.level ?? '');
  const has = (l: string) => edu.includes(l);
  const postSecondary = edu.filter((l) => ['Diploma', "Bachelor's", "Master's", 'PhD'].includes(l)).length;
  const level: Education = has('PhD')
    ? 'doctoral'
    : has("Master's")
      ? 'master'
      : has("Bachelor's")
        ? postSecondary >= 2 ? 'two_or_more' : 'bachelor'
        : has('Diploma')
          ? 'two_year'
          : has('12th')
            ? 'secondary'
            : 'none';
  crsIn.education = level;
  auIn.education = level === 'doctoral' ? 'doctorate' : ['master', 'two_or_more', 'bachelor'].includes(level) ? 'bachelor' : ['one_year', 'two_year'].includes(level) ? 'diploma' : 'none';
  if (!edu.length) notes.push('No education on the profile.');
  if (has('Diploma')) notes.push('Diplomas counted as two-year programs: adjust if shorter.');

  const tests = (c.tests as Record<string, string>[]) ?? [];
  const bands = (t: Record<string, string>): Bands => ({ l: num(t.l), r: num(t.r), w: num(t.w), s: num(t.s) });
  const ielts = tests.find((t) => t.test === 'IELTS' && t.l);
  const celpip = tests.find((t) => t.test === 'CELPIP' && t.l);
  if (ielts) {
    crsIn.first = ieltsToClb(bands(ielts));
    auIn.english = ieltsToAuEnglish(bands(ielts));
    notes.push('IELTS treated as General Training for Canada.');
  } else if (celpip) {
    crsIn.first = celpipToClb(bands(celpip));
  } else if (tests.length) {
    notes.push(`Enter CLB levels for the ${tests[0]!.test} score by hand: only IELTS and CELPIP convert automatically.`);
  } else notes.push('No English test on the profile: language set to CLB 7.');

  const work = (c.work as { from?: string; to?: string }[]) ?? [];
  const months = work.reduce((sum, w) => {
    if (!w.from) return sum;
    const from = new Date(`${w.from}-01`);
    const to = w.to ? new Date(`${w.to}-01`) : now;
    return sum + Math.max(0, (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth());
  }, 0);
  const years = Math.floor(months / 12);
  crsIn.foreignWork = years;
  auIn.overseasWork = Math.min(10, years);
  if (work.length) notes.push('All work experience counted as outside Canada and Australia.');

  if (/married|partner/i.test(c.maritalStatus ?? '')) {
    crsIn.spouse = true;
    auIn.partner = 'none';
    notes.push('Married: assumed the spouse comes along. Add their education and language for spouse points.');
  }
  return { crs: crsIn, au: auIn, notes };
}

// ── Input validation (the forms send these) ─────────────────────────────────

const band = z.coerce.number().min(0).max(12);
const bands = z.object({ l: band, r: band, w: band, s: band });
const years = z.coerce.number().min(0).max(40);
const eduEnum = z.enum(['none', 'secondary', 'one_year', 'two_year', 'bachelor', 'two_or_more', 'master', 'doctoral']);

export const crsSchema = z.object({
  age: z.coerce.number().int().min(16).max(80),
  spouse: z.boolean(),
  education: eduEnum,
  first: bands,
  firstIsFrench: z.boolean(),
  second: bands.nullable(),
  canadianWork: years,
  foreignWork: years,
  certificate: z.boolean(),
  spouseEducation: eduEnum,
  spouseLanguage: bands.nullable(),
  spouseCanadianWork: years,
  provincialNomination: z.boolean(),
  canadianEducation: z.enum(['none', 'one_two', 'three_plus']),
  sibling: z.boolean(),
});

export const auSchema = z.object({
  age: z.coerce.number().int().min(16).max(80),
  english: z.enum(['none', 'competent', 'proficient', 'superior']),
  overseasWork: years,
  australianWork: years,
  education: z.enum(['none', 'diploma', 'bachelor', 'doctorate']),
  specialistEducation: z.boolean(),
  australianStudy: z.boolean(),
  regionalStudy: z.boolean(),
  professionalYear: z.boolean(),
  communityLanguage: z.boolean(),
  partner: z.enum(['single', 'skilled', 'english', 'none']),
  nomination: z.enum(['none', '190', '491']),
});

// ── Explanation ─────────────────────────────────────────────────────────────

const explanationSchema = z.object({
  summary: z.string().describe('Two or three plain sentences a client can understand: where they stand and what matters most'),
  strengths: z.array(z.string()).max(3).describe('Factors earning the most points'),
  improvements: z.array(z.object({ change: z.string(), points: z.number() })).max(4).describe('Chosen ONLY from the WHAT-IFS list, copied exactly'),
});
export type Explanation = z.infer<typeof explanationSchema> & { model: string; sandbox: boolean };

type Calc = { title: string; total: number; max: number; lines: { label: string; points: number; max: number }[]; whatIfs: { change: string; points: number }[]; context: string };

function fallbackExplanation(c: Calc) {
  const top = [...c.lines].filter((l) => l.points > 0).sort((a, b) => b.points / b.max - a.points / a.max).slice(0, 3);
  const best = c.whatIfs[0];
  return {
    summary: `${c.context}${best ? ` The biggest single gain: ${best.change.charAt(0).toLowerCase()}${best.change.slice(1)} (+${best.points}).` : ''}`,
    strengths: top.map((l) => `${l.label}: ${l.points} of ${l.max}`),
    improvements: c.whatIfs.slice(0, 4),
  };
}

async function explain(tenantId: string, c: Calc): Promise<Explanation> {
  const r = await runStructured({
    tenantId,
    task: 'eligibility_explanation',
    tier: 'fast',
    system: `You explain points-test results for a visa consultancy, for the counsellor to share with the client.
Use ONLY the numbers given. Never change a score, never promise an invitation or visa, never give legal advice.
Improvements must be copied exactly from the WHAT-IFS list. Plain, encouraging English.`,
    prompt: `${c.title}: ${c.total} of ${c.max}. ${c.context}\n\nBREAKDOWN:\n${c.lines.map((l) => `- ${l.label}: ${l.points}/${l.max}`).join('\n')}\n\nWHAT-IFS (computed):\n${c.whatIfs.map((w) => `- ${w.change}: +${w.points}`).join('\n') || '(none)'}`,
    schema: explanationSchema,
    fallback: () => fallbackExplanation(c),
  });
  // Points always come from the calculator, whatever the model wrote.
  const known = new Map(c.whatIfs.map((w) => [w.change, w.points]));
  const improvements = r.data.improvements.filter((i) => known.has(i.change)).map((i) => ({ change: i.change, points: known.get(i.change)! }));
  return { ...r.data, improvements: improvements.length ? improvements : c.whatIfs.slice(0, 4), model: r.model, sandbox: r.sandbox };
}

// ── Save ────────────────────────────────────────────────────────────────────

export async function saveCheck(scope: Scope, clientId: string, kind: 'CRS' | 'AU_POINTS', raw: unknown) {
  const exists = await inTenant(scope, (tx) => tx.client.findUnique({ where: { id: clientId }, select: { id: true } }));
  if (!exists) throw new UserError('Client not found');

  let score: number;
  let breakdown: Prisma.InputJsonValue;
  let calc: Calc;
  let inputs: Prisma.InputJsonValue;
  if (kind === 'CRS') {
    const input = crsSchema.parse(raw) as CrsInput;
    const r = crs(input);
    score = r.total;
    breakdown = r.sections;
    inputs = input;
    calc = { title: 'Canada Express Entry CRS', total: r.total, max: 1200, lines: r.sections.flatMap((s) => s.lines), whatIfs: crsWhatIfs(input), context: `CRS score ${r.total} of 1,200. Invitation cut-offs change with every draw, so compare with the latest Express Entry rounds on the IRCC website.` };
  } else {
    const input = auSchema.parse(raw) as AuInput;
    const r = auPoints(input);
    score = r.total;
    breakdown = { lines: r.lines, passMark: r.passMark, passes: r.passes, blockers: r.blockers };
    inputs = input;
    calc = {
      title: 'Australia skilled points test',
      total: r.total,
      max: 130,
      lines: r.lines,
      whatIfs: auWhatIfs(input),
      context: `${r.total} points: ${r.blockers.length ? `not eligible yet (${r.blockers.join('; ')}).` : r.passes ? 'meets the pass mark of 65, though invitations usually need more for popular occupations.' : `below the pass mark of 65 by ${65 - r.total}.`}`,
    };
  }

  const explanation = await explain(scope.tenantId, calc);
  return inTenant(scope, async (tx) => {
    const row = await tx.eligibilityCheck.create({
      data: { tenantId: scope.tenantId, clientId, kind, inputs, score, breakdown, explanation, createdBy: scope.actorId },
    });
    await logActivity(tx, scope, { type: 'ELIGIBILITY', summary: `${kind === 'CRS' ? 'Canada CRS' : 'Australia points'}: ${score}`, clientId });
    return row.id;
  });
}
