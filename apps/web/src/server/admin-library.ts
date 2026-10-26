import 'server-only';
import { prisma, withLibraryWrite } from '@kicko/db';
import { exportLibrary, upsertLibraryItems } from '@kicko/db/library';
import { getPack, PACKS, type LibrarySeedItem } from '@kicko/packs';
import { z } from 'zod';
import { requireAdmin } from './admin';
import { clearLibraryCache } from './library';
import { UserError } from './scope';

// Kicko's library console: the people who keep the reference data correct. Every edit
// bumps the item's version and is logged; "Mark verified" records that someone checked
// it against the official source. Agencies get the change as "update available".

export const STALE_DAYS = 90;
const staleBefore = () => new Date(Date.now() - STALE_DAYS * 86_400_000);

export async function libraryOverview() {
  await requireAdmin();
  const rows = await prisma.libraryItem.groupBy({ by: ['packId', 'type'], _count: true });
  const unverified = await prisma.libraryItem.groupBy({ by: ['packId', 'type'], where: { unverified: true }, _count: true });
  const stale = await prisma.libraryItem.groupBy({ by: ['packId', 'type'], where: { OR: [{ lastReviewedAt: null }, { lastReviewedAt: { lt: staleBefore() } }] }, _count: true });
  const full = await prisma.libraryItem.count({ where: { type: 'country', coverage: 'full' } });
  const get = (list: typeof rows, p: string, t: string) => list.find((r) => r.packId === p && r.type === t)?._count ?? 0;
  return {
    fullCountries: full,
    packs: Object.values(PACKS).map((p) => ({
      id: p.id,
      name: p.name,
      types: Object.entries(p.libraryTypes).map(([type, def]) => ({ type, label: def.plural, total: get(rows, p.id, type), unverified: get(unverified, p.id, type), stale: get(stale, p.id, type) })),
    })),
  };
}

export type LibraryFilter = { pack: string; type?: string; q?: string; show?: 'all' | 'unverified' | 'stale' | 'archived'; parent?: string };

export async function listLibrary(f: LibraryFilter) {
  await requireAdmin();
  return prisma.libraryItem.findMany({
    where: {
      packId: f.pack,
      ...(f.type ? { type: f.type } : {}),
      ...(f.parent ? { parentKey: f.parent } : {}),
      ...(f.q ? { OR: [{ name: { contains: f.q, mode: 'insensitive' } }, { key: { contains: f.q, mode: 'insensitive' } }] } : {}),
      ...(f.show === 'unverified' ? { unverified: true } : {}),
      ...(f.show === 'stale' ? { OR: [{ lastReviewedAt: null }, { lastReviewedAt: { lt: staleBefore() } }] } : {}),
      status: f.show === 'archived' ? 'archived' : { not: 'archived' },
    },
    select: { id: true, type: true, key: true, parentKey: true, name: true, coverage: true, unverified: true, version: true, status: true, lastReviewedAt: true },
    orderBy: [{ type: 'asc' }, { parentKey: 'asc' }, { name: 'asc' }],
    take: 500,
  });
}

export async function getLibraryItem(id: string) {
  await requireAdmin();
  return prisma.libraryItem.findUnique({ where: { id }, include: { changes: { orderBy: { at: 'desc' }, take: 30 } } });
}

const json = (what: string) =>
  z.string().transform((v, ctx) => {
    try {
      return JSON.parse(v || 'null');
    } catch {
      ctx.addIssue({ code: 'custom', message: `${what} is not valid JSON` });
      return z.NEVER;
    }
  });

const sourceSchema = z.array(z.object({ url: z.url('Each source needs a URL'), title: z.string().optional(), publisher: z.string().optional(), official: z.boolean().optional(), verifiedAt: z.string().optional() }));

export const itemInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  parentKey: z.string().trim().max(40).optional().transform((v) => v || null),
  coverage: z.enum(['', 'basic', 'full']).optional().transform((v) => v || null),
  unverified: z.boolean(),
  data: json('Data'),
  sources: json('Sources'),
});

/** Save an edit: validates against the pack's type, bumps the version, logs what changed. */
export async function saveLibraryItem(id: string, raw: z.input<typeof itemInput>) {
  const admin = await requireAdmin();
  const input = itemInput.parse(raw);
  if (!input.data || typeof input.data !== 'object' || Array.isArray(input.data)) throw new UserError('Data must be a JSON object', 'data');
  const sources = sourceSchema.safeParse(input.sources ?? []);
  if (!sources.success) throw new UserError(sources.error.issues[0]?.message ?? 'Check the sources', 'sources');
  const item = await prisma.libraryItem.findUnique({ where: { id } });
  if (!item) throw new UserError('Not found');
  const pack = getPack(item.packId);
  const parentType = pack.libraryTypes[item.type]?.parent;
  if (parentType && input.parentKey && !(await prisma.libraryItem.findUnique({ where: { packId_type_key: { packId: item.packId, type: parentType, key: input.parentKey } } }))) {
    throw new UserError(`No ${parentType} with key ${input.parentKey}`, 'parentKey');
  }
  const seed: LibrarySeedItem = {
    type: item.type, key: item.key, name: input.name, ...(input.parentKey ? { parent: input.parentKey } : {}),
    ...(input.coverage ? { coverage: input.coverage } : {}), unverified: input.unverified, data: input.data, sources: sources.data,
  };
  const r = await upsertLibraryItems(item.packId, [seed], admin.email, 'edit');
  clearLibraryCache();
  return r.updated > 0;
}

/** Record that someone checked the item against its official sources today. */
export async function markVerified(id: string, note?: string) {
  const admin = await requireAdmin();
  await withLibraryWrite(async (tx) => {
    const item = await tx.libraryItem.findUnique({ where: { id } });
    if (!item) throw new UserError('Not found');
    await tx.libraryItem.update({ where: { id }, data: { lastReviewedAt: new Date() } });
    await tx.libraryChange.create({ data: { itemId: id, version: item.version, actor: admin.email, action: 'verify', diff: note ? { note } : undefined } });
  });
  clearLibraryCache();
}

export async function setLibraryStatus(id: string, status: 'published' | 'archived') {
  const admin = await requireAdmin();
  await withLibraryWrite(async (tx) => {
    const item = await tx.libraryItem.findUnique({ where: { id } });
    if (!item) throw new UserError('Not found');
    await tx.libraryItem.update({ where: { id }, data: { status, version: item.version + 1 } });
    await tx.libraryChange.create({ data: { itemId: id, version: item.version + 1, actor: admin.email, action: status === 'archived' ? 'archive' : 'publish' } });
  });
  clearLibraryCache();
}

export const newItemInput = z.object({
  pack: z.string(),
  type: z.string(),
  key: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_]+$/, 'Letters, numbers and _ only'),
  name: z.string().trim().min(1).max(200),
  parentKey: z.string().trim().max(40).optional().transform((v) => v || undefined),
});

export async function createLibraryItem(raw: z.input<typeof newItemInput>) {
  const admin = await requireAdmin();
  const input = newItemInput.parse(raw);
  const pack = getPack(input.pack);
  if (!pack.libraryTypes[input.type]) throw new UserError('Unknown type', 'type');
  const key = input.type === 'country' ? input.key.toUpperCase() : input.key;
  if (await prisma.libraryItem.findUnique({ where: { packId_type_key: { packId: pack.id, type: input.type, key } } })) throw new UserError('That key exists already', 'key');
  await upsertLibraryItems(pack.id, [{ type: input.type, key, name: input.name, ...(input.parentKey ? { parent: input.parentKey.toUpperCase() } : {}), unverified: true, data: {}, sources: [] }], admin.email, 'edit');
  clearLibraryCache();
  return prisma.libraryItem.findUniqueOrThrow({ where: { packId_type_key: { packId: pack.id, type: input.type, key } } });
}

/** Import a library.json (e.g. a research update) through the same versioned path. */
export async function importLibraryJson(packId: string, text: string) {
  const admin = await requireAdmin();
  getPack(packId);
  let parsed: { items?: LibrarySeedItem[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UserError('That file is not valid JSON');
  }
  const items = (parsed.items ?? []).filter((i) => i && typeof i.type === 'string' && typeof i.key === 'string' && typeof i.name === 'string');
  if (!items.length) throw new UserError('No items found (expected { items: [...] })');
  const r = await upsertLibraryItems(packId, items.map((i) => ({ ...i, data: i.data ?? {}, sources: i.sources ?? [] })), admin.email, 'import');
  clearLibraryCache();
  return r;
}

export async function libraryExport(packId: string) {
  await requireAdmin();
  return exportLibrary(packId);
}

export type LibraryRow = Awaited<ReturnType<typeof listLibrary>>[number];
