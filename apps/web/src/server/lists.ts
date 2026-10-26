import 'server-only';
import type { Prisma } from '@kicko/db';
import { z } from 'zod';
import { audit } from './audit';
import { libraryList, tenantPack } from './library';
import { inTenant, UserError, type Scope } from './scope';

// An agency's own additions to its industry pack: extra list entries (an occupation the
// library doesn't have yet), hidden library entries it never uses, and pack fields it
// doesn't need on its forms.

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

export const ownItemInput = z.object({
  type: z.string().min(1),
  name: z.string().trim().min(2, 'Name it').max(120),
  group: z.string().trim().max(40).optional().transform((v) => v || undefined),
});

export async function addOwnItem(scope: Scope, raw: z.input<typeof ownItemInput>) {
  const input = ownItemInput.parse(raw);
  const { pack } = await tenantPack(scope);
  if (!pack.libraryTypes[input.type]) throw new UserError('Unknown list');
  const key = `own_${slug(input.name)}`;
  if ((await libraryList(pack.id, input.type)).some((o) => o.name.toLowerCase() === input.name.toLowerCase())) {
    throw new UserError('That is already in the Kicko list', 'name');
  }
  await inTenant(scope, async (tx) => {
    if (await tx.tenantLibraryItem.findUnique({ where: { tenantId_packId_type_key: { tenantId: scope.tenantId, packId: pack.id, type: input.type, key } } })) {
      throw new UserError('You have added this already', 'name');
    }
    await tx.tenantLibraryItem.create({ data: { tenantId: scope.tenantId, packId: pack.id, type: input.type, key, name: input.name, data: (input.group ? { group: input.group } : {}) as Prisma.InputJsonValue } });
  });
  await audit(scope, 'settings.list', `Added ${input.name} to ${pack.libraryTypes[input.type]!.plural.toLowerCase()}`);
}

/** Hide a library entry from the agency's pickers (or show it again). Existing records keep it. */
export async function setLibraryHidden(scope: Scope, type: string, key: string, hidden: boolean) {
  const { pack } = await tenantPack(scope);
  const item = (await libraryList(pack.id, type)).find((o) => o.key === key);
  await inTenant(scope, async (tx) => {
    const own = await tx.tenantLibraryItem.findUnique({ where: { tenantId_packId_type_key: { tenantId: scope.tenantId, packId: pack.id, type, key } } });
    if (own) {
      if (key.startsWith('own_') && hidden) await tx.tenantLibraryItem.delete({ where: { id: own.id } });
      else await tx.tenantLibraryItem.update({ where: { id: own.id }, data: { hidden } });
    } else if (item) {
      await tx.tenantLibraryItem.create({ data: { tenantId: scope.tenantId, packId: pack.id, type, key, name: item.name, hidden } });
    } else throw new UserError('Not found');
  });
}

/** Show or hide one of the pack's fields on the agency's forms. Values already saved are kept. */
export async function setFieldHidden(scope: Scope, entity: 'leads' | 'clients' | 'cases', key: string, hidden: boolean) {
  const { pack } = await tenantPack(scope);
  if (!pack.fields.some((f) => f.entity === entity && f.key === key)) throw new UserError('Unknown field');
  await inTenant(scope, async (tx) => {
    const row = await tx.tenantPack.findFirst({ where: { packId: pack.id } });
    if (!row) throw new UserError('Pack not enabled');
    const settings = (row.settings as { hiddenFields?: string[] }) ?? {};
    const id = `${entity}.${key}`;
    const list = new Set(settings.hiddenFields ?? []);
    if (hidden) list.add(id);
    else list.delete(id);
    await tx.tenantPack.update({ where: { id: row.id }, data: { settings: { ...settings, hiddenFields: [...list] } as Prisma.InputJsonValue } });
  });
}

/** The agency's own and hidden entries for a list. */
export function ownItems(scope: Scope, packId: string, type: string) {
  return inTenant(scope, (tx) => tx.tenantLibraryItem.findMany({ where: { packId, type }, orderBy: { name: 'asc' } }));
}
