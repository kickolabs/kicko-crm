import 'server-only';
import { randomBytes } from 'node:crypto';
import { prisma } from '@kicko/db';
import type { TenantSettings } from '@kicko/db/provision';
import type { ChecklistItem, Stage } from '@kicko/packs';
import { Prisma } from '@kicko/db';
import { parseChecklist, parseStages, WorkflowTextError } from '@/lib/workflow-text';
import { z } from 'zod';
import { audit } from './audit';
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
  await audit(scope, 'settings.general', 'Changed general settings (name, timezone, lead assignment)');
}

/** Require two-step sign-in for everyone in the workspace. Only someone who uses it can switch it on. */
export async function setRequire2fa(scope: Scope, on: boolean) {
  if (on) {
    const me = scope.actorId ? await prisma.user.findUnique({ where: { id: scope.actorId }, select: { twoFactorEnabled: true } }) : null;
    if (!me?.twoFactorEnabled) throw new UserError('Turn on two-step sign-in for your own account first (My account & security).');
  }
  const settings: TenantSettings = { ...scope.settings, security: { ...scope.settings.security, require2fa: on } };
  await prisma.tenant.update({ where: { id: scope.tenantId }, data: { settings } });
  await audit(scope, 'settings.require_2fa', on ? 'Required two-step sign-in for everyone' : 'Stopped requiring two-step sign-in');
}

export async function rotateFormKey(scope: Scope) {
  const settings: TenantSettings = { ...scope.settings, formKey: randomBytes(12).toString('base64url') };
  await prisma.tenant.update({ where: { id: scope.tenantId }, data: { settings } });
  await audit(scope, 'settings.form_key', 'Replaced the web form & kiosk key (old embeds stop working)');
}

const key = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Stages and checklist are edited as text, one item per line, with optional [flags] (see lib/workflow-text). */
export const productInput = z.object({
  name: z.string().trim().min(2).max(80),
  active: z.boolean(),
  stages: z.string().max(8000),
  checklist: z.string().max(16000),
});

export async function updateProduct(scope: Scope, productId: string, raw: z.input<typeof productInput>) {
  const input = productInput.parse(raw);
  let checklist: ChecklistItem[];
  let stages: Stage[];
  try {
    checklist = parseChecklist(input.checklist);
    stages = parseStages(input.stages, checklist);
  } catch (e) {
    if (e instanceof WorkflowTextError) throw new UserError(e.message);
    throw e;
  }
  return inTenant(scope, async (tx) => {
    const product = await tx.visaProduct.findUnique({ where: { id: productId } });
    if (!product) throw new UserError('Product not found');
    // Cases keep the workflow they opened with, so edits only shape new cases. Only cases
    // from before snapshots existed still follow the product, and can't lose their stage.
    const removed = (product.stages as Stage[]).filter((s) => !stages.some((n) => n.key === s.key)).map((s) => s.key);
    if (removed.length) {
      const stuck = await tx.case.count({ where: { productId, workflow: { equals: Prisma.DbNull }, stageKey: { in: removed }, status: { not: 'CLOSED' } } });
      if (stuck) throw new UserError(`${stuck} open case(s) are on a stage you removed. Move them first.`);
    }
    await tx.visaProduct.update({
      where: { id: productId },
      data: { name: input.name, active: input.active, stages, checklist },
    });
  });
}
