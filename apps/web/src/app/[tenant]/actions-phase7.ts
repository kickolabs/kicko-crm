'use server';

import { revalidatePath } from 'next/cache';
import { formObject, run, type ActionResult } from '@/lib/action';
import type { CfEntity } from '@/lib/custom-fields';
import { hasFeature } from '@/lib/plans';
import type { ReportSpec } from '@/lib/reports';
import { assertCan, getCtx } from '@/lib/tenant';
import { createField, moveField, setValues, updateField } from '@/server/custom-fields';
import { PlanError } from '@/server/plan';
import { deleteSavedReport, saveReport } from '@/server/reports';
import { setRequire2fa } from '@/server/settings';
import { addSampleLeads, dismissOnboarding, removeSampleLeads } from '@/server/onboarding';
import { scopeOf } from '@/server/scope';

// Phase 7d: custom fields and saved reports.

const WRITE = { leads: 'lead.write', clients: 'client.write', cases: 'case.write' } as const;

export async function setCustomValuesAction(slug: string, entity: CfEntity, recordId: string, _prev: ActionResult | null, fd: FormData) {
  const ctx = await getCtx(slug);
  return run(async () => {
    assertCan(ctx, WRITE[entity]);
    await setValues(scopeOf(ctx), entity, recordId, formObject(fd));
    revalidatePath(`/${slug}`, 'layout');
  }, 'Saved');
}

export async function createFieldAction(slug: string, _prev: ActionResult | null, fd: FormData) {
  const ctx = await getCtx(slug);
  return run(async () => {
    assertCan(ctx, 'settings.manage');
    await createField(scopeOf(ctx), formObject(fd));
    revalidatePath(`/${slug}`, 'layout');
  }, 'Field added');
}

export async function updateFieldAction(slug: string, id: string, patch: { label?: string; options?: string; archived?: boolean }) {
  const ctx = await getCtx(slug);
  return run(async () => {
    assertCan(ctx, 'settings.manage');
    await updateField(scopeOf(ctx), id, patch);
    revalidatePath(`/${slug}`, 'layout');
  });
}

export async function editFieldAction(slug: string, id: string, _prev: ActionResult | null, fd: FormData) {
  const v = formObject(fd);
  return updateFieldAction(slug, id, { label: v.label, options: v.options });
}

export async function moveFieldAction(slug: string, id: string, dir: -1 | 1) {
  const ctx = await getCtx(slug);
  return run(async () => {
    assertCan(ctx, 'settings.manage');
    await moveField(scopeOf(ctx), id, dir);
    revalidatePath(`/${slug}`, 'layout');
  });
}

export async function saveReportAction(slug: string, spec: ReportSpec, _prev: ActionResult | null, fd: FormData): Promise<ActionResult<string>> {
  const ctx = await getCtx(slug);
  return run(async () => {
    if (!hasFeature(ctx.subscription!, 'custom_fields')) throw new PlanError('Saving reports is part of the Pro plan.');
    const r = await saveReport(scopeOf(ctx), String(fd.get('name') ?? ''), spec);
    revalidatePath(`/${slug}/reports`);
    return r.id;
  }, 'Report saved');
}

export async function setRequire2faAction(slug: string, on: boolean) {
  const ctx = await getCtx(slug);
  return run(async () => {
    assertCan(ctx, 'settings.manage');
    await setRequire2fa(scopeOf(ctx), on);
    revalidatePath(`/${slug}`, 'layout');
  });
}

export async function addSampleLeadsAction(slug: string) {
  const ctx = await getCtx(slug);
  return run(async () => {
    assertCan(ctx, 'settings.manage');
    await addSampleLeads(scopeOf(ctx));
    revalidatePath(`/${slug}`, 'layout');
  });
}

export async function removeSampleLeadsAction(slug: string) {
  const ctx = await getCtx(slug);
  return run(async () => {
    assertCan(ctx, 'settings.manage');
    await removeSampleLeads(scopeOf(ctx));
    revalidatePath(`/${slug}`, 'layout');
  });
}

export async function dismissOnboardingAction(slug: string) {
  const ctx = await getCtx(slug);
  return run(async () => {
    assertCan(ctx, 'settings.manage');
    await dismissOnboarding(scopeOf(ctx));
    revalidatePath(`/${slug}`, 'layout');
  });
}

export async function deleteReportAction(slug: string, id: string) {
  const ctx = await getCtx(slug);
  return run(async () => {
    assertCan(ctx, 'settings.manage');
    await deleteSavedReport(scopeOf(ctx), id);
    revalidatePath(`/${slug}/reports`);
  });
}
