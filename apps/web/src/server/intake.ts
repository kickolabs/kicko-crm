import 'server-only';
import type { PackField, Translated } from '@kicko/packs';
import type { Prisma } from '@kicko/db';
import { cleanPackValues, type PackValues } from '@/lib/pack-fields';
import { allowedKeys, lookupOptions, tenantPack, visibleFields } from './library';
import type { PortalCtx } from './portal-auth';
import { inTenant, logActivity, UserError, type Scope } from './scope';

// Intake questionnaires: the pack's questions about the applicant, answered in the client
// portal in the client's language. Each question is a client field, so answers go
// straight into the professional profile, validated like staff edits.

const FORM_PREFIX = 'intake:';
const pick = (t: Translated | undefined, lang: string) => (t ? (t[lang] ?? t.en) : undefined);

export async function questionnaires(scope: Scope) {
  const { pack } = await tenantPack(scope);
  return { list: pack.questionnaires?.() ?? [], languages: pack.languages ?? { en: 'English' } };
}

/** Staff: ask the client to fill in a questionnaire in their portal. */
export async function sendQuestionnaire(scope: Scope, clientId: string, key: string) {
  const { list } = await questionnaires(scope);
  const q = list.find((x) => x.key === key);
  if (!q) throw new UserError('Unknown questionnaire');
  return inTenant(scope, async (tx) => {
    if (!(await tx.client.findUnique({ where: { id: clientId } }))) throw new UserError('Client not found');
    const formId = `${FORM_PREFIX}${key}`;
    const open = await tx.formRequest.findFirst({ where: { clientId, formId, status: 'OPEN' } });
    if (!open) await tx.formRequest.create({ data: { tenantId: scope.tenantId, clientId, formId, keys: q.questions.map((x) => x.field), createdBy: scope.actorId } });
    await logActivity(tx, scope, { type: 'FORMS', summary: `Sent "${q.title.en}" to the client's portal`, clientId });
  });
}

type PortalQuestion = { field: PackField; label: string; hint?: string };

/** The open questionnaire for a portal client, in `lang`, with current answers. */
export async function portalIntake(p: PortalCtx, lang: string) {
  const { list, languages } = await questionnaires(p.scope);
  const open = await inTenant(p.scope, (tx) => tx.formRequest.findFirst({ where: { clientId: p.client.id, status: 'OPEN', formId: { startsWith: FORM_PREFIX } }, orderBy: { createdAt: 'asc' } }));
  const q = open ? list.find((x) => `${FORM_PREFIX}${x.key}` === open.formId) : undefined;
  if (!q) return null;
  const { pack, settings } = await tenantPack(p.scope);
  const fields = visibleFields(pack, settings, 'clients');
  const language = languages[lang] ? lang : 'en';
  const questions: PortalQuestion[] = q.questions.flatMap((x) => {
    const field = fields.find((f) => f.key === x.field);
    if (!field) return [];
    const label = pick(x.label, language)!;
    const hint = pick(x.hint, language);
    return [{ field: { ...field, label, hint: hint ?? field.hint }, label, hint }];
  });
  const client = await inTenant(p.scope, (tx) => tx.client.findUnique({ where: { id: p.client.id }, select: { packData: true } }));
  const lookups = await lookupOptions(p.scope, pack);
  return {
    key: q.key,
    requestId: open!.id,
    title: pick(q.title, language)!,
    intro: pick(q.intro, language)!,
    language,
    languages,
    questions,
    values: (client?.packData as PackValues) ?? {},
    lookups: Object.fromEntries(Object.entries(lookups).map(([t, l]) => [t, l.map(({ key, name, group }) => ({ key, name, group }))])),
    groupLabels: pack.groupLabels ?? {},
  };
}

export async function savePortalIntake(p: PortalCtx, raw: Record<string, string | string[]>) {
  const intake = await portalIntake(p, 'en');
  if (!intake) throw new UserError('There is nothing to answer right now');
  const { pack } = await tenantPack(p.scope);
  const fields = intake.questions.map((q) => q.field);
  await inTenant(p.scope, async (tx) => {
    const c = await tx.client.findUnique({ where: { id: p.client.id }, select: { packData: true } });
    const packData = cleanPackValues(fields, raw, await allowedKeys(p.scope, pack), (c?.packData as PackValues) ?? {});
    await tx.client.update({ where: { id: p.client.id }, data: { packData: packData as Prisma.InputJsonValue } });
    await tx.formRequest.update({ where: { id: intake.requestId }, data: { status: 'DONE', completedAt: new Date() } });
    await logActivity(tx, { ...p.scope, actorId: null }, { type: 'FORMS', summary: `Client completed "${intake.title}" in the portal`, clientId: p.client.id });
  });
}

/** Whether a client has an intake questionnaire waiting (for the portal home). */
export async function intakeWaiting(p: PortalCtx) {
  return inTenant(p.scope, (tx) => tx.formRequest.count({ where: { clientId: p.client.id, status: 'OPEN', formId: { startsWith: FORM_PREFIX } } }));
}

