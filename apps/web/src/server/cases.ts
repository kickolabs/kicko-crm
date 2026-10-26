import 'server-only';
import { nextRef, prisma, type CaseOutcome, type CaseStatus, type Prisma, type Tx } from '@kicko/db';
import type { Stage } from '@kicko/packs';
import type { PackValues } from '@/lib/pack-fields';
import { gateProblems, lodgedBy, mainStages, snapshotFor, stagesOf, type RuleContext } from '@/lib/workflow';
import { z } from 'zod';
import { tenantPack } from './library';
import { inTenant, logActivity, UserError, type Scope } from './scope';
import { syncChecklistTx } from './documents';
import { defaultBranch } from './branches';

export { lodgedBy, stagesOf };

/** What a workflow's conditions are judged against: the applicant's profile. */
async function ruleContext(tx: Tx, scope: Scope, clientId: string, organizationId?: string | null): Promise<RuleContext> {
  const client = await tx.client.findUnique({ where: { id: clientId }, select: { packData: true, family: { where: { included: true }, select: { id: true } } } });
  const fields = (client?.packData as PackValues) ?? {};
  let occupationGroup: string | null = null;
  if (typeof fields.occupation === 'string') {
    const { pack } = await tenantPack(scope);
    const own = await tx.tenantLibraryItem.findFirst({ where: { packId: pack.id, type: 'occupation', key: fields.occupation } });
    const lib = own ? null : await prisma.libraryItem.findUnique({ where: { packId_type_key: { packId: pack.id, type: 'occupation', key: fields.occupation } } });
    occupationGroup = (((own ?? lib)?.data as { group?: string } | undefined)?.group) ?? null;
  }
  return { occupationGroup, hasDependants: (client?.family.length ?? 0) > 0, hasEmployer: !!organizationId, fields };
}

/** Tasks a stage creates when a case enters it, assigned to the case owner. */
async function stageTasksTx(tx: Tx, scope: Scope, c: { id: string; clientId: string; ownerId: string | null }, stage: Stage) {
  if (!stage.tasks?.length) return;
  await tx.task.createMany({
    data: stage.tasks.map((t) => ({
      tenantId: scope.tenantId,
      title: t.title,
      dueAt: t.dueDays != null ? new Date(Date.now() + t.dueDays * 86_400_000) : null,
      assigneeId: c.ownerId,
      createdBy: scope.actorId,
      caseId: c.id,
      clientId: c.clientId,
    })),
  });
}

export async function openCaseTx(
  tx: Tx,
  scope: Scope,
  input: { clientId: string; productId: string; ownerId?: string | null },
) {
  const product = await tx.visaProduct.findUnique({ where: { id: input.productId } });
  if (!product) throw new UserError('Unknown visa product');
  const client = await tx.client.findUnique({ where: { id: input.clientId } });
  if (!client) throw new UserError('Client not found');
  // The case keeps the workflow as it is today, with only the steps that apply to this applicant.
  const workflow = snapshotFor(product, await ruleContext(tx, scope, client.id));
  const first = mainStages(workflow.stages)[0];
  if (!first) throw new UserError('This visa product has no stages configured');

  const ref = await nextRef(tx, scope.tenantId, `case_${product.country}`, `KCK-${product.country}`);
  const ownerId = input.ownerId ?? client.ownerId ?? scope.actorId;
  const c = await tx.case.create({
    data: {
      tenantId: scope.tenantId,
      ref,
      branchId: await defaultBranch(tx, scope, ownerId),
      clientId: client.id,
      productId: product.id,
      stageKey: first.key,
      ownerId,
      workflow: workflow as unknown as Prisma.InputJsonValue,
    },
  });
  await stageTasksTx(tx, scope, c, first);
  await tx.stageHistory.create({
    data: { tenantId: scope.tenantId, caseId: c.id, fromKey: null, toKey: first.key, byUserId: scope.actorId },
  });
  await syncChecklistTx(tx, scope, c.id);
  await logActivity(tx, scope, {
    type: 'CASE_OPENED',
    summary: `Case ${ref} opened · ${product.name}`,
    clientId: client.id,
    caseId: c.id,
  });
  return c;
}

export function openCase(scope: Scope, input: { clientId: string; productId: string; ownerId?: string | null }) {
  return inTenant(scope, (tx) => openCaseTx(tx, scope, input));
}

/**
 * Move a case to another stage. Moving forward past a stage with a gate (documents that
 * must be verified, fields that must be filled, a follow-up) is refused with what's
 * missing; owners and admins may override with a reason, which is logged.
 */
export async function moveStage(scope: Scope, caseId: string, toKey: string, opts: { override?: string; canOverride?: boolean } = {}) {
  const res = await moveStageTx(scope, caseId, toKey, opts);
  if (res.moved) {
    const { fireAutomation } = await import('./whatsapp/automations');
    await fireAutomation(scope, 'CASE_STAGE', {
      clientId: res.moved.clientId,
      caseId,
      stageKey: res.moved.stageKey,
      vars: [res.moved.firstName, res.moved.stageName, res.moved.product],
    });
  }
  return res.updated;
}

export class GateError extends UserError {
  constructor(readonly problems: string[], readonly canOverride: boolean) {
    super(`Not ready to move on: ${problems.join('; ')}.`);
  }
}

function moveStageTx(scope: Scope, caseId: string, toKey: string, opts: { override?: string; canOverride?: boolean }) {
  return inTenant(scope, async (tx) => {
    const c = await tx.case.findUnique({ where: { id: caseId }, include: { product: true, client: true } });
    if (!c) throw new UserError('Case not found');
    if (c.status === 'CLOSED') throw new UserError('Reopen the case before changing its stage');
    const stages = stagesOf(c);
    const from = stages.find((s) => s.key === c.stageKey);
    const to = stages.find((s) => s.key === toKey);
    if (!to) throw new UserError('Unknown stage');
    if (to.key === c.stageKey) return { updated: c, moved: null };

    // Gates: every stage being left behind (moving forward) must have what it requires.
    const fromIdx = stages.findIndex((s) => s.key === c.stageKey);
    const toIdx = stages.findIndex((s) => s.key === to.key);
    const passing = toIdx > fromIdx ? stages.slice(Math.max(0, fromIdx), toIdx).filter((s) => !s.track) : [];
    const gated = passing.filter((s) => s.requires);
    if (gated.length) {
      const docs = await tx.document.findMany({ where: { caseId }, select: { checklistKey: true, name: true, status: true } });
      const followUp = await tx.task.count({ where: { caseId, done: false, dueAt: { gt: new Date() } } });
      const problems = gated.flatMap((s) =>
        gateProblems(s, {
          docs: Object.fromEntries(docs.filter((d) => d.checklistKey).map((d) => [d.checklistKey!, d.status])),
          fields: { ...(c.client.packData as PackValues), ...(c.packData as PackValues) },
          hasFollowUp: followUp > 0,
          docName: (k) => docs.find((d) => d.checklistKey === k)?.name ?? k,
        }),
      );
      if (problems.length) {
        const reason = opts.override?.trim();
        if (!reason || !opts.canOverride) throw new GateError(problems, !!opts.canOverride);
        await logActivity(tx, scope, { type: 'STAGE_OVERRIDE', summary: `Moved past a stage requirement: ${reason}`, caseId, clientId: c.clientId, data: { problems, reason } });
      }
    }

    const now = new Date();
    const updated = await tx.case.update({
      where: { id: caseId },
      data: {
        stageKey: to.key,
        stageSince: now,
        // First time a case reaches (or skips past) its "lodged"/"submitted" stage, stamp the date.
        lodgedAt: !c.lodgedAt && lodgedBy(stages, to.key) ? now : undefined,
      },
    });
    await tx.stageHistory.create({
      data: { tenantId: scope.tenantId, caseId, fromKey: c.stageKey, toKey: to.key, byUserId: scope.actorId },
    });
    await logActivity(tx, scope, {
      type: 'STAGE_CHANGED',
      summary: `${from?.name ?? c.stageKey} → ${to.name}`,
      caseId,
      clientId: c.clientId,
    });
    await stageTasksTx(tx, scope, c, to);
    return {
      updated,
      moved: { clientId: c.clientId, firstName: c.client.firstName, stageKey: to.key, stageName: to.name, product: c.product.name },
    };
  });
}

export async function setCaseStatus(
  scope: Scope,
  caseId: string,
  status: CaseStatus,
  outcome?: CaseOutcome | null,
  closing: { reason?: string; rating?: number; comment?: string } = {},
) {
  return inTenant(scope, async (tx) => {
    const c = await tx.case.findUnique({ where: { id: caseId } });
    if (!c) throw new UserError('Case not found');
    if (status === 'CLOSED' && !outcome) throw new UserError('Choose an outcome to close the case');
    await tx.case.update({
      where: { id: caseId },
      data: {
        status,
        outcome: status === 'CLOSED' ? outcome : null,
        decisionAt: status === 'CLOSED' && outcome !== 'WITHDRAWN' ? (c.decisionAt ?? new Date()) : status === 'OPEN' ? null : c.decisionAt,
        ...(status === 'CLOSED'
          ? {
              closureReason: closing.reason?.trim().slice(0, 500) || null,
              feedback: closing.rating || closing.comment?.trim()
                ? { rating: closing.rating && closing.rating >= 1 && closing.rating <= 5 ? Math.round(closing.rating) : null, comment: closing.comment?.trim().slice(0, 1000) || null, at: new Date().toISOString() }
                : undefined,
            }
          : {}),
      },
    });
    const label =
      status === 'CLOSED' ? `Closed · ${outcome!.toLowerCase()}${closing.reason?.trim() ? ` · ${closing.reason.trim()}` : ''}` : status === 'ON_HOLD' ? 'Put on hold' : 'Reopened';
    await logActivity(tx, scope, { type: 'CASE_STATUS', summary: label, caseId, clientId: c.clientId });
  });
}

export async function updateCaseDetails(
  scope: Scope,
  caseId: string,
  input: { ownerId: string | null; branchId?: string | null; dates: Record<string, string | null> },
) {
  return inTenant(scope, async (tx) => {
    const c = await tx.case.findUnique({ where: { id: caseId } });
    if (!c) throw new UserError('Case not found');
    if (input.ownerId) {
      const m = await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId: scope.tenantId, userId: input.ownerId } },
      });
      if (!m?.active) throw new UserError('That owner is not an active team member');
    }
    if (input.branchId && !(await tx.branch.findUnique({ where: { id: input.branchId } }))) throw new UserError('Branch not found');
    const dates = Object.fromEntries(Object.entries(input.dates).filter(([, v]) => v));
    await tx.case.update({ where: { id: caseId }, data: { ownerId: input.ownerId, ...(input.branchId !== undefined ? { branchId: input.branchId } : {}), dates } });
    if (c.ownerId !== input.ownerId) {
      await logActivity(tx, scope, { type: 'ASSIGNED', summary: 'Case owner changed', caseId, clientId: c.clientId });
    }
  });
}

export const extrasInput = z.object({
  nextAction: z.string().trim().max(300).optional().transform((v) => v || null),
  // [{ label, value }] as JSON, e.g. application number, UCI, file number
  refs: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return [];
      try {
        const rows = JSON.parse(v) as { label?: string; value?: string }[];
        return rows
          .map((r) => ({ label: String(r.label ?? '').trim().slice(0, 60), value: String(r.value ?? '').trim().slice(0, 120) }))
          .filter((r) => r.label && r.value)
          .slice(0, 20);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Could not read the reference numbers' });
        return z.NEVER;
      }
    }),
});

/** Next action and reference numbers (application, file and government numbers). */
export async function updateCaseExtras(scope: Scope, caseId: string, raw: z.input<typeof extrasInput>) {
  const input = extrasInput.parse(raw);
  return inTenant(scope, async (tx) => {
    const c = await tx.case.findUnique({ where: { id: caseId } });
    if (!c) throw new UserError('Case not found');
    await tx.case.update({ where: { id: caseId }, data: { nextAction: input.nextAction, refs: input.refs } });
    const before = JSON.stringify(c.refs);
    if (before !== JSON.stringify(input.refs)) {
      await logActivity(tx, scope, { type: 'CASE_UPDATED', summary: 'Reference numbers updated', caseId, clientId: c.clientId, data: { refs: input.refs } });
    }
  });
}

export const TRACK_STATUSES = ['todo', 'in_progress', 'done', 'not_needed'] as const;

/** Status of a side track (medical, police clearance, loan…) beside the main stages. */
export async function setTrack(scope: Scope, caseId: string, key: string, status: (typeof TRACK_STATUSES)[number]) {
  if (!TRACK_STATUSES.includes(status)) throw new UserError('Unknown status');
  return inTenant(scope, async (tx) => {
    const c = await tx.case.findUnique({ where: { id: caseId }, include: { product: true } });
    if (!c) throw new UserError('Case not found');
    const stage = stagesOf(c).find((s) => s.key === key && s.track);
    if (!stage) throw new UserError('Unknown track');
    const tracks = { ...(c.tracks as Record<string, unknown>), [key]: { status, at: new Date().toISOString() } };
    await tx.case.update({ where: { id: caseId }, data: { tracks: tracks as Prisma.InputJsonValue } });
    await logActivity(tx, scope, { type: 'STAGE_CHANGED', summary: `${stage.name}: ${status.replace('_', ' ')}`, caseId, clientId: c.clientId });
  });
}
