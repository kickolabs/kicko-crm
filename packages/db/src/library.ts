import type { LibrarySeedItem } from '@kicko/packs';
import { prisma, withLibraryWrite, type Prisma } from './index';

// Writing the global reference library: shared by the import script and Kicko's admin
// console. Every change bumps the item's version and is logged, so workspaces see
// "update available" instead of anything changing under them.

// jsonb stores object keys in its own order, so compare with keys sorted.
const canon = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v === 'object' && !(v instanceof Date)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
      : v;
export const sameJson = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

const reviewed = (it: LibrarySeedItem) => {
  const dates = it.sources.map((s) => s.verifiedAt).filter(Boolean).sort();
  return dates.length ? new Date(dates[dates.length - 1]!) : null;
};

/** Add or update items by (type, key). Unchanged items are left alone. */
export async function upsertLibraryItems(packId: string, items: LibrarySeedItem[], actor: string, action: 'import' | 'edit' = 'import') {
  const existing = new Map((await prisma.libraryItem.findMany({ where: { packId } })).map((r) => [`${r.type}:${r.key}`, r]));
  let created = 0;
  let updated = 0;
  const CHUNK = 50;
  for (let i = 0; i < items.length; i += CHUNK) {
    await withLibraryWrite(async (tx) => {
      for (const it of items.slice(i, i + CHUNK)) {
        const row = {
          name: it.name,
          parentKey: it.parent ?? null,
          coverage: it.coverage ?? null,
          unverified: it.unverified ?? false,
          data: it.data as Prisma.InputJsonValue,
          sources: it.sources as Prisma.InputJsonValue,
        };
        const prev = existing.get(`${it.type}:${it.key}`);
        if (!prev) {
          const r = await tx.libraryItem.create({ data: { packId, type: it.type, key: it.key, ...row, lastReviewedAt: reviewed(it) } });
          await tx.libraryChange.create({ data: { itemId: r.id, version: 1, actor, action } });
          created++;
          continue;
        }
        const fields = (Object.keys(row) as (keyof typeof row)[]).filter((k) => !sameJson(prev[k], row[k]));
        if (!fields.length) continue;
        await tx.libraryItem.update({ where: { id: prev.id }, data: { ...row, version: prev.version + 1, lastReviewedAt: reviewed(it) ?? prev.lastReviewedAt } });
        await tx.libraryChange.create({ data: { itemId: prev.id, version: prev.version + 1, actor, action, diff: { fields } } });
        updated++;
      }
    });
  }
  return { created, updated, unchanged: items.length - created - updated };
}

/** The library as a pack's library.json, e.g. to copy admin edits back into the repository. */
export async function exportLibrary(packId: string) {
  const rows = await prisma.libraryItem.findMany({ where: { packId, status: { not: 'archived' } }, orderBy: [{ type: 'asc' }, { key: 'asc' }] });
  const items: LibrarySeedItem[] = rows.map((r) => ({
    type: r.type,
    key: r.key,
    ...(r.parentKey ? { parent: r.parentKey } : {}),
    name: r.name,
    ...(r.coverage ? { coverage: r.coverage as 'basic' | 'full' } : {}),
    ...(r.unverified ? { unverified: true } : {}),
    data: r.data as Record<string, unknown>,
    sources: r.sources as LibrarySeedItem['sources'],
  }));
  return { pack: packId, builtAt: new Date().toISOString().slice(0, 10), items };
}
