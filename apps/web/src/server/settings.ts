import 'server-only';
import { randomBytes } from 'node:crypto';
import { prisma } from '@kicko/db';
import type { TenantSettings } from '@kicko/db/provision';
import type { ChecklistItem, Stage } from '@kicko/db/visa-catalog';
import { z } from 'zod';
import { inTenant, UserError, type Scope } from './scope';

export const generalInput = z.object({
  name: z.string().trim().min(2, 'Agency name is too short').max(80),
  timezone: z.string().trim().min(3).max(60),
  leadAssignment: z.enum(['round_robin', 'manual']),
});

export async function updateGeneral(scope: Scope, raw: z.input<typeof generalInput>) {
  const input = generalInput.parse(raw);
  try {
    new Intl.DateTimeFormat('en', { timeZone: input.timezone });
  } catch {
    throw new UserError('Unknown timezone');
  }
  const settings: TenantSettings = { ...scope.settings, leadAssignment: input.leadAssignment };
  await prisma.tenant.update({
    where: { id: scope.tenantId },
    data: { name: input.name, timezone: input.timezone, settings },
  });
}

export async function rotateFormKey(scope: Scope) {
  const settings: TenantSettings = { ...scope.settings, formKey: randomBytes(12).toString('base64url') };
  await prisma.tenant.update({ where: { id: scope.tenantId }, data: { settings } });
}

const key = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Stages and checklist are edited as one item per line; checklist lines are "Group: Item" with optional "(optional)". */
export const productInput = z.object({
  name: z.string().trim().min(2).max(80),
  active: z.boolean(),
  stages: z.string().max(4000),
  checklist: z.string().max(10000),
});

export async function updateProduct(scope: Scope, productId: string, raw: z.input<typeof productInput>) {
  const input = productInput.parse(raw);
  const stageNames = input.stages.split('\n').map((s) => s.trim()).filter(Boolean);
  if (stageNames.length < 2) throw new UserError('Add at least two stages');
  const stages: Stage[] = stageNames.map((name) => ({ key: key(name), name }));
  if (new Set(stages.map((s) => s.key)).size !== stages.length) throw new UserError('Stage names must be unique');

  const checklist: ChecklistItem[] = input.checklist
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const optional = /\(optional\)\s*$/i.test(line);
      const clean = line.replace(/\(optional\)\s*$/i, '').trim();
      const [group, ...rest] = clean.includes(':') ? clean.split(':') : ['General', clean];
      const name = rest.join(':').trim() || group!.trim();
      return { key: key(`${group}_${name}`), name, group: group!.trim(), required: !optional };
    });

  return inTenant(scope, async (tx) => {
    const product = await tx.visaProduct.findUnique({ where: { id: productId } });
    if (!product) throw new UserError('Product not found');
    // Open cases sitting on a stage that would disappear must be moved first.
    const removed = (product.stages as Stage[]).filter((s) => !stages.some((n) => n.key === s.key)).map((s) => s.key);
    if (removed.length) {
      const stuck = await tx.case.count({ where: { productId, stageKey: { in: removed }, status: { not: 'CLOSED' } } });
      if (stuck) throw new UserError(`${stuck} open case(s) are on a stage you removed. Move them first.`);
    }
    await tx.visaProduct.update({
      where: { id: productId },
      data: { name: input.name, active: input.active, stages, checklist },
    });
  });
}
