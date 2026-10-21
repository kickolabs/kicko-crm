import 'server-only';
import { z } from 'zod';
import { runStructured } from './run';

// AI document check: the model reads the file and extracts fields; plain code then
// compares them with the client's profile and checks expiry. Advisory only:
// a person still verifies every document.

export const docReadSchema = z.object({
  documentType: z.string().describe('What this document actually is, e.g. "Indian passport, data page", "Bank statement"'),
  matchesExpected: z.enum(['yes', 'no', 'unsure']).describe('Is it the document that was requested?'),
  legible: z.boolean().describe('false if blurry, cut off, too dark or unreadable'),
  fields: z.object({
    fullName: z.string().nullable(),
    dateOfBirth: z.string().nullable().describe('YYYY-MM-DD'),
    documentNumber: z.string().nullable(),
    issueDate: z.string().nullable().describe('YYYY-MM-DD'),
    expiryDate: z.string().nullable().describe('YYYY-MM-DD'),
    issuingCountry: z.string().nullable(),
  }),
  issues: z
    .array(z.object({ severity: z.enum(['high', 'medium', 'low']), message: z.string() }))
    .max(6)
    .describe('Problems a document officer should know: missing pages, cropped edges, wrong person, tampering signs'),
});
export type DocRead = z.infer<typeof docReadSchema>;
export type Issue = DocRead['issues'][number];
export type DocCheck = DocRead & { model: string; sandbox: boolean; checkedAt: string };

const SYSTEM = `You check documents uploaded to a visa and immigration consultancy.
Read the file and record exactly what it shows. Never guess a field you can't read: use null.
Dates as YYYY-MM-DD. Flag real problems only. Do not judge visa eligibility.`;

export const READABLE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export async function readDocument(
  tenantId: string,
  file: { bytes: Buffer | null; mime: string; fileName: string; size: number },
  expected: { name: string; group: string },
) {
  return runStructured({
    tenantId,
    task: 'document_check',
    tier: 'smart',
    maxTokens: 1000,
    system: SYSTEM,
    prompt: `Requested document: "${expected.name}" (${expected.group}). File name: ${file.fileName}.`,
    attachments: file.bytes ? [{ mime: file.mime, data: file.bytes.toString('base64') }] : undefined,
    schema: docReadSchema,
    fallback: () => heuristicRead(file, expected),
  });
}

// ── Profile comparison (code, not AI) ───────────────────────────────────────

const tokens = (s: string) => new Set(s.toLowerCase().normalize('NFKD').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1));
const day = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function compareWithProfile(
  read: DocRead,
  expected: { name: string },
  profile: { fullName: string; dob: Date | null; passportNumber: string | null },
  now = new Date(),
): Issue[] {
  const out: Issue[] = [];
  const f = read.fields;
  if (read.matchesExpected === 'no') out.push({ severity: 'high', message: `This looks like ${/^[aeiou]/i.test(read.documentType) ? 'an' : 'a'} ${read.documentType}, not "${expected.name}".` });
  if (!read.legible) out.push({ severity: 'high', message: 'Hard to read. Ask for a clearer scan or photo.' });

  if (f.fullName) {
    const doc = tokens(f.fullName);
    const mine = tokens(profile.fullName);
    const shared = [...mine].filter((t) => doc.has(t)).length;
    // Order differs a lot on Indian documents (surname first, initials), so compare as sets.
    if (mine.size && !shared) out.push({ severity: 'high', message: `Name on the document ("${f.fullName}") doesn't match the client ("${profile.fullName}").` });
    else if (mine.size && shared < Math.min(mine.size, doc.size)) out.push({ severity: 'low', message: `Name differs slightly: "${f.fullName}" vs "${profile.fullName}". Check spelling is consistent across documents.` });
  }
  const dob = day(f.dateOfBirth);
  if (dob && profile.dob && dob !== profile.dob.toISOString().slice(0, 10)) {
    out.push({ severity: 'high', message: `Date of birth ${fmt(dob)} doesn't match the profile (${fmt(profile.dob.toISOString().slice(0, 10))}).` });
  }
  const isPassport = /passport/i.test(expected.name) || /passport/i.test(read.documentType);
  const num = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (isPassport && f.documentNumber && profile.passportNumber && num(f.documentNumber) !== num(profile.passportNumber)) {
    out.push({ severity: 'high', message: `Passport number ${f.documentNumber} doesn't match the profile (${profile.passportNumber}).` });
  }
  const exp = day(f.expiryDate);
  if (exp) {
    const ms = new Date(`${exp}T00:00:00Z`).getTime() - now.getTime();
    if (ms < 0) out.push({ severity: 'high', message: `Expired on ${fmt(exp)}.` });
    else if (isPassport && ms < 183 * 86400_000) out.push({ severity: 'medium', message: `Expires ${fmt(exp)}: under 6 months away, and many visas need 6+ months of validity.` });
    else if (!isPassport && ms < 90 * 86400_000) out.push({ severity: 'medium', message: `Expires soon (${fmt(exp)}).` });
  }
  return out;
}

export function mergeIssues(a: Issue[], b: Issue[]) {
  const seen = new Set<string>();
  const order = { high: 0, medium: 1, low: 2 };
  return [...a, ...b]
    .filter((i) => {
      const k = i.message.toLowerCase().slice(0, 40);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((x, y) => order[x.severity] - order[y.severity]);
}

// ── Sandbox: no model, so only file name, type and size can be judged ───────

const KINDS: [string, RegExp][] = [
  ['passport', /passport/i],
  ['English test result', /ielts|pte|toefl|celpip|duolingo|english test|\boet\b/i],
  ['bank or financial statement', /bank|statement|financ|fund|salary slip|itr|tax return/i],
  ['academic document', /transcript|marksheet|mark sheet|degree|diploma|provisional|10th|12th|graduation/i],
  ['photograph', /photo|picture|selfie/i],
  ['offer or admission letter', /offer|admission|\bloa\b|\bcas\b|\bcoe\b|i-?20/i],
  ['police certificate', /police|\bpcc\b/i],
  ['medical report', /medical|health/i],
  ['CV or resume', /resume|\bcv\b|curriculum/i],
  ['statement of purpose', /\bsop\b|statement of purpose/i],
  ['birth certificate', /birth/i],
  ['marriage certificate', /marriage/i],
];
const kindOf = (s: string) => KINDS.find(([, re]) => re.test(s))?.[0] ?? null;

export function heuristicRead(file: { mime: string; fileName: string; size: number }, expected: { name: string }): DocRead {
  const want = kindOf(expected.name);
  const got = kindOf(file.fileName.replace(/[_\-.]+/g, ' '));
  const matches = want && got ? (want === got ? 'yes' : 'no') : 'unsure';
  const tiny = file.mime.startsWith('image/') && file.size < 15_000;
  return {
    documentType: matches === 'no' ? got! : (want ?? 'document'),
    matchesExpected: matches,
    legible: !tiny,
    fields: { fullName: null, dateOfBirth: null, documentNumber: null, issueDate: null, expiryDate: null, issuingCountry: null },
    issues: [],
  };
}
