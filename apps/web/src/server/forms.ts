import 'server-only';
import type { Prisma, Tx } from '@kicko/db';
import { fullName } from '@/lib/format';
import { detailsKey, isAnswerKey, QUESTIONS, type AnswerKey, type Answers } from '@/lib/forms/questions';
import { buildSheet, formById, FORMS, type SheetClient } from '@/lib/forms/sheet';
import type { PortalCtx } from './portal-auth';
import { inTenant, logActivity, UserError, type Scope } from './scope';
import { requireFeature } from './plan';

// Government form answer sheets on a client: answers shared across forms, gaps
// requested from the client through the portal.

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

type ClientWithFamily = Prisma.ClientGetPayload<{ include: { family: true } }>;

export function toSheetClient(c: ClientWithFamily): SheetClient {
  return {
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phoneNormalized ?? c.phone,
    dob: iso(c.dob),
    gender: c.gender,
    nationality: c.nationality,
    passportNumber: c.passportNumber,
    passportExpiry: iso(c.passportExpiry),
    maritalStatus: c.maritalStatus,
    address: c.address,
    education: (c.education as SheetClient['education']) ?? [],
    tests: (c.tests as SheetClient['tests']) ?? [],
    work: (c.work as SheetClient['work']) ?? [],
    family: c.family.map((f) => ({ relation: f.relation, name: f.name, dob: iso(f.dob), passportNumber: f.passportNumber })),
  };
}

const loadClient = (tx: Tx, clientId: string) => tx.client.findUnique({ where: { id: clientId }, include: { family: true } });

export async function clientSheet(scope: Scope, clientId: string, formId: string) {
  await requireFeature(scope.tenantId, 'forms');
  const form = formById(formId);
  if (!form) throw new UserError('Unknown form');
  const c = await inTenant(scope, (tx) => loadClient(tx, clientId));
  if (!c) throw new UserError('Client not found');
  return { sheet: buildSheet(form, toSheetClient(c), c.formAnswers as Answers), client: c };
}

// ── Answers ─────────────────────────────────────────────────────────────────

/** Validate and normalise submitted answers; only known keys (and yes/no details). */
function cleanAnswers(raw: Record<string, unknown>, allowed?: Set<string>) {
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(raw)) {
    const base = k.endsWith('.details') ? k.slice(0, -'.details'.length) : k;
    if (!isAnswerKey(base) || (allowed && !allowed.has(base))) continue;
    if (k !== base && QUESTIONS[base].type !== 'yesno') continue;
    const s = String(val ?? '').trim().slice(0, 2000);
    const q = QUESTIONS[base];
    if (k === base && q.type === 'date' && s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new UserError(`${q.label}: enter a valid date`);
    if (k === base && q.type === 'yesno' && s && s !== 'Yes' && s !== 'No') throw new UserError(`${q.label}: choose Yes or No`);
    out[k] = s;
  }
  return out;
}

async function writeAnswers(tx: Tx, clientId: string, values: Record<string, string>, by: 'client' | 'staff') {
  const c = await tx.client.findUnique({ where: { id: clientId } });
  if (!c) throw new UserError('Client not found');
  const answers = { ...(c.formAnswers as Answers) };
  const at = new Date().toISOString();
  for (const [k, v] of Object.entries(values)) {
    if (answers[k]?.v === v) continue; // unchanged: keep who answered it
    if (v) answers[k] = { v, by, at };
    else delete answers[k];
  }
  await tx.client.update({ where: { id: clientId }, data: { formAnswers: answers } });
  // Close requests that are now fully answered.
  const open = await tx.formRequest.findMany({ where: { clientId, status: 'OPEN' } });
  for (const r of open) {
    if ((r.keys as string[]).every((k) => answers[k]?.v)) {
      await tx.formRequest.update({ where: { id: r.id }, data: { status: 'DONE', completedAt: new Date() } });
    }
  }
  return answers;
}

export async function saveAnswers(scope: Scope, clientId: string, raw: Record<string, unknown>) {
  const values = cleanAnswers(raw);
  if (!Object.keys(values).length) throw new UserError('Nothing to save');
  await inTenant(scope, (tx) => writeAnswers(tx, clientId, values, 'staff'));
}

/** Staff: ask the client (in their portal) for the answers this form still needs. */
export async function requestAnswers(scope: Scope, clientId: string, formId: string) {
  const { sheet } = await clientSheet(scope, clientId, formId);
  if (!sheet.missingAsk.length) throw new UserError('Nothing to ask: every question the client can answer is filled');
  return inTenant(scope, async (tx) => {
    const open = await tx.formRequest.findFirst({ where: { clientId, formId, status: 'OPEN' } });
    if (open) await tx.formRequest.update({ where: { id: open.id }, data: { keys: sheet.missingAsk } });
    else await tx.formRequest.create({ data: { tenantId: scope.tenantId, clientId, formId, keys: sheet.missingAsk, createdBy: scope.actorId } });
    await logActivity(tx, scope, { type: 'FORMS', summary: `Asked the client for ${sheet.missingAsk.length} answers for ${sheet.form.title}`, clientId });
    return sheet.missingAsk.length;
  });
}

// ── Client portal ───────────────────────────────────────────────────────────

/** Questions the agency asked this client that are still unanswered. */
export async function portalQuestions(p: PortalCtx) {
  return inTenant(p.scope, async (tx) => {
    const c = await tx.client.findUnique({ where: { id: p.client.id } });
    const answers = (c?.formAnswers as Answers) ?? {};
    const open = await tx.formRequest.findMany({ where: { clientId: p.client.id, status: 'OPEN' }, orderBy: { createdAt: 'asc' } });
    const keys = [...new Set(open.flatMap((r) => r.keys as string[]))].filter(isAnswerKey) as AnswerKey[];
    return {
      forms: [...new Set(open.map((r) => formById(r.formId)?.title ?? r.formId))],
      questions: keys.map((k) => ({
        key: k,
        ...QUESTIONS[k],
        value: answers[k]?.v ?? '',
        detailsValue: 'details' in QUESTIONS[k] ? (answers[detailsKey(k)]?.v ?? '') : undefined,
      })),
      pending: keys.filter((k) => !answers[k]?.v).length,
    };
  });
}

export async function portalSaveAnswers(p: PortalCtx, raw: Record<string, unknown>) {
  const { questions } = await portalQuestions(p);
  const allowed = new Set<string>(questions.map((q) => q.key));
  const values = cleanAnswers(raw, allowed);
  // A "Yes" needs details for the agency to use it.
  for (const q of questions) {
    if (values[q.key] === 'Yes' && 'details' in QUESTIONS[q.key] && !values[`${q.key}.details`]?.trim()) {
      throw new UserError(`${q.label}: please add the details`);
    }
  }
  await inTenant(p.scope, async (tx) => {
    await writeAnswers(tx, p.client.id, values, 'client');
    const n = Object.keys(values).filter((k) => !k.endsWith('.details') && values[k]).length;
    await logActivity(tx, { ...p.scope, actorId: null }, { type: 'FORMS', summary: `Client answered ${n} form question${n === 1 ? '' : 's'} in the portal`, clientId: p.client.id });
  });
}

/** Completion per form, for the client's Forms tab. */
export async function formsOverview(scope: Scope, clientId: string) {
  const c = await inTenant(scope, (tx) => loadClient(tx, clientId));
  if (!c) return [];
  const open = await inTenant(scope, (tx) => tx.formRequest.findMany({ where: { clientId, status: 'OPEN' } }));
  const sc = toSheetClient(c);
  return FORMS.map((f) => {
    const s = buildSheet(f, sc, c.formAnswers as Answers);
    return { id: f.id, title: f.title, authority: f.authority, use: f.use, filled: s.filled, total: s.total, requested: open.some((r) => r.formId === f.id) };
  });
}

export const clientName = (c: { firstName: string; lastName: string | null }) => fullName(c);
