import 'server-only';
import { z } from 'zod';
import type { Tx } from '@kicko/db';
import { branchLimit, PLANS, type PlanId } from '@/lib/plans';
import { audit } from './audit';
import { getSubscription, PlanError } from './plan';
import { inTenant, UserError, type Scope } from './scope';

// Branches (offices) inside one agency workspace. Starter 1, Growth 3, Pro unlimited.
// Over the limit after a downgrade, existing branches stay; only adding is blocked.

const input = z.object({ name: z.string().trim().min(2, 'Branch name is too short').max(60), city: z.string().trim().max(60).optional().default('') });

const NEXT_PLAN: Record<PlanId, PlanId | null> = { starter: 'growth', growth: 'pro', pro: null };

export function limitMessage(plan: string) {
  const p = PLANS[plan as PlanId] ?? PLANS.starter;
  const next = NEXT_PLAN[plan as PlanId];
  const has = p.branches === 1 ? '1 branch' : `${p.branches} branches`;
  return `${p.name} includes ${has}.${next ? ` Upgrade to ${PLANS[next].name} for ${PLANS[next].branches === Infinity ? 'unlimited branches' : `up to ${PLANS[next].branches}`}.` : ''}`;
}

export async function addBranch(scope: Scope, raw: unknown) {
  const v = input.parse(raw);
  const sub = await getSubscription(scope.tenantId);
  return inTenant(scope, async (tx) => {
    const count = await tx.branch.count();
    if (count >= branchLimit(sub)) throw new PlanError(limitMessage(sub.plan));
    if (await tx.branch.findFirst({ where: { name: { equals: v.name, mode: 'insensitive' } } })) throw new UserError('A branch with this name already exists');
    const b = await tx.branch.create({ data: { tenantId: scope.tenantId, name: v.name, city: v.city || null } });
    await audit(scope, 'settings.branch', `Added branch ${v.name}`);
    return b;
  });
}

export async function updateBranch(scope: Scope, id: string, raw: unknown) {
  const v = input.parse(raw);
  await inTenant(scope, (tx) => tx.branch.update({ where: { id }, data: { name: v.name, city: v.city || null } }));
}

/** Records keep existing; they just lose the branch (people, leads and cases). */
export async function removeBranch(scope: Scope, id: string) {
  await inTenant(scope, async (tx) => {
    if ((await tx.branch.count()) <= 1) throw new UserError('Keep at least one branch');
    const b = await tx.branch.findUnique({ where: { id } });
    if (!b) throw new UserError('Branch not found');
    await tx.membership.updateMany({ where: { branchId: id }, data: { branchId: null } });
    await tx.branch.delete({ where: { id } });
    await audit(scope, 'settings.branch', `Removed branch ${b.name}`);
  });
}

export async function setMemberBranch(scope: Scope, userId: string, branchId: string | null) {
  await inTenant(scope, async (tx) => {
    if (branchId && !(await tx.branch.findUnique({ where: { id: branchId } }))) throw new UserError('Branch not found');
    await tx.membership.update({ where: { tenantId_userId: { tenantId: scope.tenantId, userId } }, data: { branchId } });
  });
}

/** A new lead or case belongs to its owner's branch, else the person creating it. Null with one branch. */
export async function defaultBranch(tx: Tx, scope: Pick<Scope, 'tenantId' | 'actorId'>, ownerId?: string | null) {
  if ((await tx.branch.count()) <= 1) return null;
  for (const userId of [ownerId, scope.actorId]) {
    if (!userId) continue;
    const m = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: scope.tenantId, userId } }, select: { branchId: true } });
    if (m?.branchId) return m.branchId;
  }
  return null;
}

export async function setRecordBranch(scope: Scope, kind: 'lead' | 'case', id: string, branchId: string | null) {
  await inTenant(scope, async (tx) => {
    if (branchId && !(await tx.branch.findUnique({ where: { id: branchId } }))) throw new UserError('Branch not found');
    if (kind === 'lead') await tx.lead.update({ where: { id }, data: { branchId } });
    else await tx.case.update({ where: { id }, data: { branchId } });
  });
}
