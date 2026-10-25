// Load an industry pack's library.json into the global reference library.
// Idempotent: unchanged items are left alone; changed items get a new version and a
// change-log entry, so workspaces see "update available" and nothing changes silently.
//
//   npm run library:import -- immigration

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { prisma, withLibraryWrite, type Prisma } from '../src/index';
import type { LibrarySeedItem } from '@kicko/packs';

const packId = process.argv[2] ?? 'immigration';
const require = createRequire(import.meta.url);
const file = require.resolve(`@kicko/packs/package.json`).replace(/package\.json$/, `src/${packId}/library.json`);
const { items } = JSON.parse(readFileSync(file, 'utf8')) as { items: LibrarySeedItem[] };

// jsonb stores object keys in its own order, so compare with keys sorted.
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' && !(v instanceof Date)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
    : v;
const same = (a: unknown, b: unknown) =>
  a instanceof Date || b instanceof Date ? String(a) === String(b) : JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const reviewed = (it: LibrarySeedItem) => {
  const dates = it.sources.map((s) => s.verifiedAt).filter(Boolean).sort();
  return dates.length ? new Date(dates[dates.length - 1]!) : null;
};

async function main() {
  const existing = new Map(
    (await prisma.libraryItem.findMany({ where: { packId } })).map((r) => [`${r.type}:${r.key}`, r]),
  );
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
          lastReviewedAt: reviewed(it),
        };
        const prev = existing.get(`${it.type}:${it.key}`);
        if (!prev) {
          const r = await tx.libraryItem.create({ data: { packId, type: it.type, key: it.key, ...row } });
          await tx.libraryChange.create({ data: { itemId: r.id, version: 1, actor: 'import', action: 'import' } });
          created++;
        } else if (
          prev.name !== row.name || prev.parentKey !== row.parentKey || prev.coverage !== row.coverage ||
          prev.unverified !== row.unverified || !same(prev.data, row.data) || !same(prev.sources, row.sources)
        ) {
          const fields = Object.keys(row).filter((k) => !same((prev as Record<string, unknown>)[k], (row as Record<string, unknown>)[k]));
          await tx.libraryItem.update({ where: { id: prev.id }, data: { ...row, version: prev.version + 1 } });
          await tx.libraryChange.create({ data: { itemId: prev.id, version: prev.version + 1, actor: 'import', action: 'import', diff: { fields } } });
          updated++;
        }
      }
    });
  }
  console.log(`${packId}: ${created} added, ${updated} updated, ${items.length - created - updated} unchanged`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
