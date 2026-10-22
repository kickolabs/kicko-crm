import 'server-only';
import { nextRef, type CaseOutcome, type CaseStatus, type Tx } from '@kicko/db';
import type { Stage } from '@kicko/db/visa-catalog';
import { inTenant, logActivity, UserError, type Scope } from './scope';
import { syncChecklistTx } from './documents';
import { defaultBranch } from './branches';

export function stagesOf(product: { stages: unknown }): Stage[] {
  return Array.isArray(product.stages) ? (product.stages as Stage[]) : [];
}

export async function openCaseTx(
  tx: Tx,
  scope: Scope,
  input: { clientId: string; productId: string; ownerId?: string | null },
) {
  const product = await tx.visaProduct.findUnique({ where: { id: input.productId } });
  if (!product) throw new UserError('Unknown visa product');
  const first = stagesOf(product)[0];
  if (!first) throw new UserError('This visa product has no stages configured');
  const client = await tx.client.findUnique({ where: { id: input.clientId } });
  if (!client) throw new UserError('Client not found');

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
    },
  });
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

export async function moveStage(scope: Scope, caseId: string, toKey: string) {
  const res = await moveStageTx(scope, caseId, toKey);
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

function moveStageTx(scope: Scope, caseId: string, toKey: string) {
  return inTenant(scope, async (tx) => {
    const c = await tx.case.findUnique({ where: { id: caseId }, include: { product: true, client: true } });
    if (!c) throw new UserError('Case not found');
    if (c.status === 'CLOSED') throw new UserError('Reopen the case before changing its stage');
    const stages = stagesOf(c.product);
    const from = stages.find((s) => s.key === c.stageKey);
    const to = stages.find((s) => s.key === toKey);
    if (!to) throw new UserError('Unknown stage');
    if (to.key === c.stageKey) return { updated: c, moved: null };

    const now = new Date();
    const updated = await tx.case.update({
      where: { id: caseId },
      data: {
        stageKey: to.key,
        stageSince: now,
        // First time a case reaches a "lodged"/"submitted" stage, stamp the date.
        lodgedAt: !c.lodgedAt && /lodged|submitted|petition_filed/.test(to.key) ? now : undefined,
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
      },
    });
    const label =
      status === 'CLOSED' ? `Closed · ${outcome!.toLowerCase()}` : status === 'ON_HOLD' ? 'Put on hold' : 'Reopened';
    await logActivity(tx, scope, { type: 'CASE_STATUS', summary: label, caseId, clientId: c.clientId });
  });
}

export async function updateCaseDetails(
  scope: Scope,
  caseId: string,
  input: { ownerId: string | null; dates: Record<string, string | null> },
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
    const dates = Object.fromEntries(Object.entries(input.dates).filter(([, v]) => v));
    await tx.case.update({ where: { id: caseId }, data: { ownerId: input.ownerId, dates } });
    if (c.ownerId !== input.ownerId) {
      await logActivity(tx, scope, { type: 'ASSIGNED', summary: 'Case owner changed', caseId, clientId: c.clientId });
    }
  });
}
