'use server';

import { revalidatePath } from 'next/cache';
import { run, type ActionResult } from '@/lib/action';
import { assertCan, getCtx } from '@/lib/tenant';
import { finishImport, findExisting, importChunk, startImport, undoImport, type ImportOptions } from '@/server/import';
import { scopeOf } from '@/server/scope';

// Spreadsheet import. Owners and admins only: it writes thousands of records at once.

async function admin(slug: string) {
  const ctx = await getCtx(slug);
  assertCan(ctx, 'settings.manage');
  return scopeOf(ctx);
}

export async function findExistingAction(slug: string, keys: string[]) {
  return run(async () => findExisting(await admin(slug), keys));
}

export async function startImportAction(slug: string, options: ImportOptions): Promise<ActionResult<string>> {
  return run(async () => startImport(await admin(slug), options));
}

export async function importChunkAction(slug: string, batchId: string, chunk: { firstRow: number; rows: string[][]; mapping: Record<string, number> }) {
  return run(async () => importChunk(await admin(slug), batchId, chunk));
}

export async function finishImportAction(slug: string, batchId: string) {
  return run(async () => {
    const r = await finishImport(await admin(slug), batchId);
    revalidatePath(`/${slug}`, 'layout');
    return r;
  });
}

export async function undoImportAction(slug: string, batchId: string) {
  return run(async () => {
    const r = await undoImport(await admin(slug), batchId);
    revalidatePath(`/${slug}`, 'layout');
    return r;
  }, 'Import undone');
}
