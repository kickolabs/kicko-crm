'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { formObject, run, type ActionResult } from '@/lib/action';
import { assertCan, getCtx } from '@/lib/tenant';
import { scopeOf } from '@/server/scope';
import * as orgs from '@/server/organizations';

type Prev = ActionResult | null;
const refresh = (slug: string) => revalidatePath(`/${slug}`, 'layout');

export async function createOrganizationAction(slug: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'organization.write');
    return (await orgs.createOrganization(scopeOf(ctx), formObject(fd))).id;
  });
  if (res.ok && res.data) {
    refresh(slug);
    redirect(`/${slug}/organizations/${res.data}`);
  }
  return res;
}

export async function updateOrganizationAction(slug: string, id: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'organization.write');
    await orgs.updateOrganization(scopeOf(ctx), id, formObject(fd));
  }, 'Saved');
  refresh(slug);
  return res;
}

export async function setOrganizationActiveAction(slug: string, id: string, active: boolean) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'organization.write');
    await orgs.setOrganizationActive(scopeOf(ctx), id, active);
  });
  refresh(slug);
  return res;
}

export async function createOpeningAction(slug: string, organizationId: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'organization.write');
    return (await orgs.createOpening(scopeOf(ctx), organizationId, formObject(fd))).id;
  });
  if (res.ok && res.data) {
    refresh(slug);
    redirect(`/${slug}/organizations/openings/${res.data}`);
  }
  return res;
}

export async function updateOpeningAction(slug: string, id: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'organization.write');
    await orgs.updateOpening(scopeOf(ctx), id, formObject(fd));
  }, 'Saved');
  refresh(slug);
  return res;
}

export async function addCandidateAction(slug: string, openingId: string, clientId: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'organization.write');
    await orgs.addCandidate(scopeOf(ctx), openingId, clientId);
  }, 'Shortlisted');
  refresh(slug);
  return res;
}

export async function setCandidateStageAction(slug: string, candidateId: string, stage: orgs.CandidateStage) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'organization.write');
    return orgs.setCandidateStage(scopeOf(ctx), candidateId, stage);
  }, stage === 'hired' ? 'Hired: the offer is on their case' : undefined);
  refresh(slug);
  return res;
}

export async function removeCandidateAction(slug: string, candidateId: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'organization.write');
    await orgs.removeCandidate(scopeOf(ctx), candidateId);
  });
  refresh(slug);
  return res;
}
