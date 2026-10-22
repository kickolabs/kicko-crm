'use server';

import { revalidatePath } from 'next/cache';
import { formObject, run, type ActionResult } from '@/lib/action';
import { assertCan, getCtx } from '@/lib/tenant';
import { addBranch, removeBranch, setMemberBranch, setRecordBranch, updateBranch } from '@/server/branches';
import { scopeOf } from '@/server/scope';

// Branches: Settings → Branches, the team's branch, and the branch of a lead or case.

export async function addBranchAction(slug: string, _prev: ActionResult | null, fd: FormData) {
  const ctx = await getCtx(slug);
  return run(async () => {
    assertCan(ctx, 'settings.manage');
    await addBranch(scopeOf(ctx), formObject(fd));
    revalidatePath(`/${slug}`, 'layout');
  }, 'Branch added');
}

export async function updateBranchAction(slug: string, id: string, _prev: ActionResult | null, fd: FormData) {
  const ctx = await getCtx(slug);
  return run(async () => {
    assertCan(ctx, 'settings.manage');
    await updateBranch(scopeOf(ctx), id, formObject(fd));
    revalidatePath(`/${slug}`, 'layout');
  }, 'Saved');
}

export async function removeBranchAction(slug: string, id: string) {
  const ctx = await getCtx(slug);
  return run(async () => {
    assertCan(ctx, 'settings.manage');
    await removeBranch(scopeOf(ctx), id);
    revalidatePath(`/${slug}`, 'layout');
  }, 'Branch removed');
}

export async function setMemberBranchAction(slug: string, userId: string, branchId: string) {
  const ctx = await getCtx(slug);
  return run(async () => {
    assertCan(ctx, 'team.manage');
    await setMemberBranch(scopeOf(ctx), userId, branchId || null);
    revalidatePath(`/${slug}`, 'layout');
  });
}

export async function setRecordBranchAction(slug: string, kind: 'lead' | 'case', id: string, branchId: string) {
  const ctx = await getCtx(slug);
  return run(async () => {
    assertCan(ctx, kind === 'lead' ? 'lead.write' : 'case.write');
    await setRecordBranch(scopeOf(ctx), kind, id, branchId || null);
    revalidatePath(`/${slug}`, 'layout');
  });
}
