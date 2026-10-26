// Load an industry pack's library.json into the global reference library.
// Idempotent: unchanged items are left alone; changed items get a new version and a
// change-log entry, so workspaces see "update available" and nothing changes silently.
//
//   npm run library:import -- immigration

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { prisma, withTenant, type Prisma } from '../src/index';
import { seedOf } from '../src/provision';
import { upsertLibraryItems } from '../src/library';
import { getPack } from '@kicko/packs';
import type { LibrarySeedItem } from '@kicko/packs';

const packId = process.argv[2] ?? 'immigration';
const require = createRequire(import.meta.url);
const file = require.resolve(`@kicko/packs/package.json`).replace(/package\.json$/, `src/${packId}/library.json`);
const { items } = JSON.parse(readFileSync(file, 'utf8')) as { items: LibrarySeedItem[] };

async function main() {
  const r = await upsertLibraryItems(packId, items, 'import');
  console.log(`${packId}: ${r.created} added, ${r.updated} updated, ${r.unchanged} unchanged`);
  await backfillInfo();
}

/**
 * Workflows that have no reference info yet (created before the library existed) get it
 * from their library pathway. Reference info only: stages and checklists are left alone,
 * and the workflow is marked at the library's current version.
 */
async function backfillInfo() {
  const pack = getPack(packId);
  const lib = new Map((await prisma.libraryItem.findMany({ where: { packId, type: pack.workflowType } })).map((i) => [i.key, i]));
  let filled = 0;
  for (const t of await prisma.tenant.findMany({ select: { id: true } })) {
    await withTenant(t.id, async (tx) => {
      const products = await tx.visaProduct.findMany({ where: { packId, libraryKey: { not: null } } });
      for (const p of products) {
        const item = lib.get(p.libraryKey!);
        if (!item || Object.keys((p.info as object) ?? {}).length) continue;
        const info = pack.workflowFromLibrary(seedOf(item)).info ?? {};
        await tx.visaProduct.update({ where: { id: p.id }, data: { info: info as Prisma.InputJsonValue, libraryVersion: item.version } });
        filled++;
      }
    });
  }
  if (filled) console.log(`${packId}: reference info added to ${filled} workflows`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
