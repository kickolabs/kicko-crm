import 'server-only';
import type { Prisma } from '@kicko/db';
import { z } from 'zod';
import { CF_LIMIT, cfClean, cfKey, parseOptions, type CfDef, type CfEntity, type CfType, type CfValues } from '@/lib/custom-fields';
import { requireFeature } from './plan';
import { audit } from './audit';
import { inTenant, logActivity, UserError, type Scope } from './scope';

// Custom fields (Pro plan). Definitions per entity; values in each record's
// customFields JSON. Values stay readable after a downgrade; editing needs the plan.

const entity = z.enum(['leads', 'clients', 'cases']);

export async function listFields(scope: Scope, e?: CfEntity, opts: { archived?: boolean } = {}) {
  const rows = await inTenant(scope, (tx) =>
    tx.customField.findMany({ where: { ...(e ? { entity: e } : {}), ...(opts.archived ? {} : { archived: false }) }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
  );
  return rows.map((r) => ({ id: r.id, entity: r.entity as CfEntity, key: r.key, label: r.label, type: r.type as CfType, options: r.options, archived: r.archived }));
}
export type FieldRow = Awaited<ReturnType<typeof listFields>>[number];

const fieldInput = z.object({
  entity,
  label: z.string().trim().min(1, 'Name the field').max(60),
  type: z.enum(['text', 'number', 'date', 'select', 'yesno']),
  options: z.string().max(3000).optional().default(''),
});

export async function createField(scope: Scope, raw: unknown) {
  await requireFeature(scope.tenantId, 'custom_fields');
  const input = fieldInput.parse(raw);
  const options = input.type === 'select' ? parseOptions(input.options) : [];
  if (input.type === 'select' && options.length < 2) throw new UserError('Add at least two options, one per line');
  const created = await inTenant(scope, async (tx) => {
    const all = await tx.customField.findMany({ where: { entity: input.entity }, select: { key: true, label: true, archived: true, sortOrder: true } });
    if (all.filter((f) => !f.archived).length >= CF_LIMIT) throw new UserError(`Up to ${CF_LIMIT} fields per record type. Archive one you no longer use.`);
    if (all.some((f) => !f.archived && f.label.toLowerCase() === input.label.toLowerCase())) throw new UserError(`There is already a field called “${input.label}”`);
    return tx.customField.create({
      data: {
        tenantId: scope.tenantId,
        entity: input.entity,
        key: cfKey(input.label, all.map((f) => f.key)),
        label: input.label,
        type: input.type,
        options,
        sortOrder: Math.max(0, ...all.map((f) => f.sortOrder)) + 1,
      },
    });
  });
  await audit(scope, 'settings.custom_field', `Added the ${input.entity.slice(0, -1)} field “${created.label}”`);
  return created;
}

/** Rename, change dropdown options, or archive / restore. The type can't change (values would no longer fit). */
export async function updateField(scope: Scope, id: string, raw: unknown) {
  await requireFeature(scope.tenantId, 'custom_fields');
  const input = z.object({ label: z.string().trim().min(1).max(60).optional(), options: z.string().max(3000).optional(), archived: z.boolean().optional() }).parse(raw);
  return inTenant(scope, async (tx) => {
    const f = await tx.customField.findUnique({ where: { id } });
    if (!f) throw new UserError('Field not found');
    const options = input.options !== undefined && f.type === 'select' ? parseOptions(input.options) : undefined;
    if (options && options.length < 2) throw new UserError('Add at least two options, one per line');
    if (input.archived === false) {
      const active = await tx.customField.count({ where: { entity: f.entity, archived: false } });
      if (active >= CF_LIMIT) throw new UserError(`Up to ${CF_LIMIT} fields per record type`);
    }
    await tx.customField.update({ where: { id }, data: { label: input.label, options, archived: input.archived } });
    return f;
  }).then(async (f) => {
    const what = input.archived === true ? 'Archived' : input.archived === false ? 'Restored' : 'Edited';
    await audit(scope, 'settings.custom_field', `${what} the ${f.entity.slice(0, -1)} field “${input.label ?? f.label}”`);
  });
}

export async function moveField(scope: Scope, id: string, dir: -1 | 1) {
  await requireFeature(scope.tenantId, 'custom_fields');
  return inTenant(scope, async (tx) => {
    const f = await tx.customField.findUnique({ where: { id } });
    if (!f) throw new UserError('Field not found');
    const list = await tx.customField.findMany({ where: { entity: f.entity, archived: false }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    const i = list.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    await Promise.all(list.map((x, n) => tx.customField.update({ where: { id: x.id }, data: { sortOrder: n } })));
  });
}

/** Save the custom field values of one record. Keys not sent are left as they are. */
export async function setValues(scope: Scope, e: CfEntity, recordId: string, raw: Record<string, string>) {
  await requireFeature(scope.tenantId, 'custom_fields');
  entity.parse(e);
  const defs = (await listFields(scope, e)) as CfDef[];
  return inTenant(scope, async (tx) => {
    const where = { id: recordId };
    const current =
      e === 'leads' ? await tx.lead.findUnique({ where, select: { customFields: true } })
      : e === 'clients' ? await tx.client.findUnique({ where, select: { customFields: true } })
      : await tx.case.findUnique({ where, select: { customFields: true } });
    if (!current) throw new UserError('Record not found');
    const values: CfValues = { ...((current.customFields ?? {}) as CfValues) };
    for (const def of defs) {
      if (!(def.key in raw)) continue;
      const r = cfClean(def, raw[def.key], 'DMY');
      if (!r.ok) throw new UserError(r.error);
      if (r.value === null) delete values[def.key];
      else values[def.key] = r.value;
    }
    const data = { customFields: values as Prisma.InputJsonObject };
    if (e === 'leads') await tx.lead.update({ where, data });
    else if (e === 'clients') await tx.client.update({ where, data });
    else await tx.case.update({ where, data });
    await logActivity(tx, scope, {
      type: 'PROFILE_UPDATED',
      summary: 'Details updated',
      ...(e === 'leads' ? { leadId: recordId } : e === 'clients' ? { clientId: recordId } : { caseId: recordId }),
    });
  });
}
