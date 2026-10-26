import 'server-only';
import { prisma, type Prisma, type VisaCategory } from '@kicko/db';
import { seedOf } from '@kicko/db/provision';
import type { WorkflowTemplate } from '@kicko/packs';
import { z } from 'zod';
import { countryName } from '@/lib/countries';
import { audit } from './audit';
import { libraryList, tenantPack } from './library';
import { inTenant, UserError, type Scope } from './scope';

// An agency's workflows come from its industry pack's library (adopted, then edited as
// its own copy) or from a generic template for any country. Library changes reach a
// workflow only when the agency applies them, and never change cases already open:
// every case keeps the workflow snapshot it opened with.

const asProduct = (scope: Scope, packId: string, t: WorkflowTemplate, libraryKey: string | null, libraryVersion: number | null) => ({
  tenantId: scope.tenantId,
  code: t.code,
  country: t.country,
  category: t.category as VisaCategory,
  name: t.name,
  kind: t.kind ?? null,
  stages: t.stages as unknown as Prisma.InputJsonValue,
  checklist: t.checklist as unknown as Prisma.InputJsonValue,
  info: (t.info ?? {}) as Prisma.InputJsonValue,
  packId,
  libraryKey,
  libraryVersion,
});

/** Library pathways for a country, marked with whether this agency already has them. */
export async function libraryPathways(scope: Scope, country: string) {
  const { pack } = await tenantPack(scope);
  const items = await prisma.libraryItem.findMany({ where: { packId: pack.id, type: pack.workflowType, parentKey: country, status: 'published' }, orderBy: { name: 'asc' } });
  const mine = await inTenant(scope, (tx) => tx.visaProduct.findMany({ where: { libraryKey: { in: items.map((i) => i.key) } }, select: { id: true, libraryKey: true } }));
  return items.map((i) => ({
    key: i.key,
    name: i.name,
    version: i.version,
    unverified: i.unverified,
    template: pack.workflowFromLibrary(seedOf(i)),
    adoptedId: mine.find((m) => m.libraryKey === i.key)?.id ?? null,
  }));
}

/** Add a library pathway to the agency's workflows. */
export async function adoptPathway(scope: Scope, key: string) {
  const { pack } = await tenantPack(scope);
  const item = await prisma.libraryItem.findUnique({ where: { packId_type_key: { packId: pack.id, type: pack.workflowType, key } } });
  if (!item || item.status !== 'published') throw new UserError('That pathway is not in the library');
  const t = pack.workflowFromLibrary(seedOf(item));
  const created = await inTenant(scope, async (tx) => {
    if (await tx.visaProduct.findFirst({ where: { OR: [{ libraryKey: key }, { code: t.code }] } })) throw new UserError('You already have this workflow');
    return tx.visaProduct.create({ data: asProduct(scope, pack.id, t, key, item.version) });
  });
  await audit(scope, 'settings.workflow_added', `Added ${countryName(t.country)} · ${t.name} from the library`);
  return created;
}

export const customInput = z.object({
  country: z.string().trim().regex(/^[A-Z]{2}$/, 'Pick a country'),
  category: z.string().trim().min(1, 'Pick a visa type'),
  name: z.string().trim().min(2, 'Name the workflow').max(80),
});

/** A workflow of the agency's own, for any country, starting from the pack's generic template. */
export async function createCustomWorkflow(scope: Scope, raw: z.input<typeof customInput>) {
  const input = customInput.parse(raw);
  const { pack } = await tenantPack(scope);
  if (!(input.category in pack.categories)) throw new UserError('Pick a visa type', 'category');
  const countries = new Set((await libraryList(pack.id, pack.regionType ?? 'country')).map((c) => c.key));
  if (!countries.has(input.country)) throw new UserError('Pick a country from the list', 'country');
  const generic = pack.genericWorkflows().find((g) => g.category === input.category) ?? pack.genericWorkflows().at(-1)!;
  const base = `${input.country}_${input.category}_${input.name}`.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 40);
  const created = await inTenant(scope, async (tx) => {
    let code = base;
    for (let n = 2; await tx.visaProduct.findFirst({ where: { code } }); n++) code = `${base}_${n}`;
    return tx.visaProduct.create({ data: asProduct(scope, pack.id, { ...generic, code, country: input.country, name: input.name }, null, null) });
  });
  await audit(scope, 'settings.workflow_added', `Created ${countryName(input.country)} · ${input.name}`);
  return created;
}

/** Workflows whose library pathway has changed since they were adopted. */
export async function libraryUpdates(scope: Scope) {
  const { pack } = await tenantPack(scope);
  const products = await inTenant(scope, (tx) => tx.visaProduct.findMany({ where: { libraryKey: { not: null } }, select: { id: true, libraryKey: true, libraryVersion: true } }));
  if (!products.length) return new Map<string, number>();
  const items = await prisma.libraryItem.findMany({ where: { packId: pack.id, type: pack.workflowType, key: { in: products.map((p) => p.libraryKey!) } }, select: { key: true, version: true } });
  const latest = new Map(items.map((i) => [i.key, i.version]));
  return new Map(products.filter((p) => (latest.get(p.libraryKey!) ?? 0) > (p.libraryVersion ?? 0)).map((p) => [p.id, latest.get(p.libraryKey!)!]));
}

/**
 * Take the library's latest version of a workflow: reference info always; stages and
 * checklist too unless the agency keeps its own. New cases use it; open cases don't change.
 */
export async function applyLibraryUpdate(scope: Scope, productId: string, opts: { keepStages: boolean }) {
  const { pack } = await tenantPack(scope);
  const product = await inTenant(scope, (tx) => tx.visaProduct.findUnique({ where: { id: productId } }));
  if (!product?.libraryKey) throw new UserError('This workflow is not from the library');
  const item = await prisma.libraryItem.findUnique({ where: { packId_type_key: { packId: pack.id, type: pack.workflowType, key: product.libraryKey } } });
  if (!item) throw new UserError('The library no longer has this pathway');
  const t = pack.workflowFromLibrary(seedOf(item));
  await inTenant(scope, (tx) =>
    tx.visaProduct.update({
      where: { id: productId },
      data: {
        info: (t.info ?? {}) as Prisma.InputJsonValue,
        libraryVersion: item.version,
        ...(opts.keepStages ? {} : { stages: t.stages as unknown as Prisma.InputJsonValue, checklist: t.checklist as unknown as Prisma.InputJsonValue }),
      },
    }),
  );
  await audit(scope, 'settings.workflow_updated', `Applied library v${item.version} to ${product.name}${opts.keepStages ? ' (reference info only)' : ''}`);
}
