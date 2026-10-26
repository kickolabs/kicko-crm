'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { CaseOutcome, CaseStatus, LeadStatus, Role } from '@kicko/db';
import { formObject, run, type ActionResult } from '@/lib/action';
import { packRaw } from '@/lib/pack-fields';
import { can } from '@/lib/permissions';
import { assertCan, getCtx } from '@/lib/tenant';
import { scopeOf, UserError } from '@/server/scope';
import * as leads from '@/server/leads';
import * as cases from '@/server/cases';
import * as clients from '@/server/clients';
import * as work from '@/server/work';
import * as checkins from '@/server/checkins';
import * as team from '@/server/team';
import * as settings from '@/server/settings';
import * as workflows from '@/server/workflows';
import * as vault from '@/server/vault';
import * as docTemplates from '@/server/doc-templates';
import * as lists from '@/server/lists';
import * as intake from '@/server/intake';
import * as notifications from '@/server/notifications';
import * as rules from '@/server/rules';

type Prev = ActionResult | null;

const refresh = (slug: string) => revalidatePath(`/${slug}`, 'layout');

// ─── Leads ──────────────────────────────────────────────────────────────────

export async function createLeadAction(slug: string, _: Prev, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx(slug);
  const raw = formObject(fd);
  const res = await run(async () => {
    assertCan(ctx, 'lead.write');
    const input = { ...raw, waOptIn: raw.waOptIn === 'on' } as unknown as leads.LeadInput;
    return leads.createLead(scopeOf(ctx), input, { allowDuplicate: raw.allowDuplicate === '1', pack: packRaw(fd) });
  });
  if (res.ok && res.data?.status === 'duplicate') {
    const m = res.data.matches[0]!;
    return {
      ok: false,
      error: `Possible duplicate: ${m.kind} ${m.ref} ${m.name} has the same ${m.matchedOn}. Submit again to create anyway.`,
      fieldErrors: { allowDuplicate: '1', duplicateHref: `/${slug}/${m.kind === 'lead' ? 'leads' : 'clients'}/${m.id}` },
    };
  }
  if (res.ok && res.data?.status === 'created') {
    refresh(slug);
    redirect(`/${slug}/leads/${res.data.leadId}`);
  }
  return res;
}

export async function updateLeadAction(slug: string, leadId: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'lead.write');
    const { waOptIn: _ignored, ...raw } = formObject(fd);
    await leads.updateLead(scopeOf(ctx), leadId, raw as unknown as leads.LeadInput, packRaw(fd));
  }, 'Saved');
  refresh(slug);
  return res;
}

export async function setLeadStatusAction(slug: string, leadId: string, status: LeadStatus, lostReason?: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'lead.write');
    await leads.setLeadStatus(scopeOf(ctx), leadId, status, lostReason);
  });
  refresh(slug);
  return res;
}

export async function markLostAction(slug: string, leadId: string, _: Prev, fd: FormData) {
  const reason = String(fd.get('reason') ?? '').trim();
  if (!reason) return { ok: false, error: 'Pick or type a reason', fieldErrors: { reason: 'Required' } } as ActionResult;
  return setLeadStatusAction(slug, leadId, 'LOST', reason);
}

export async function convertLeadAction(slug: string, leadId: string, _: Prev, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx(slug);
  const productId = String(fd.get('productId') ?? '') || null;
  const res = await run(async () => {
    assertCan(ctx, 'client.write');
    return leads.convertLead(scopeOf(ctx), leadId, { productId });
  });
  if (res.ok && res.data) {
    refresh(slug);
    redirect(res.data.caseId ? `/${slug}/cases/${res.data.caseId}` : `/${slug}/clients/${res.data.clientId}`);
  }
  return res;
}

// ─── Clients ────────────────────────────────────────────────────────────────

export async function updateClientAction(slug: string, clientId: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'client.write');
    await clients.updateClientProfile(scopeOf(ctx), clientId, formObject(fd));
  }, 'Profile saved');
  refresh(slug);
  return res;
}

export async function updateClientJsonAction(slug: string, clientId: string, field: 'tests' | 'education' | 'work', value: unknown) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'client.write');
    await clients.updateClientJson(scopeOf(ctx), clientId, field, value);
  }, 'Saved');
  refresh(slug);
  return res;
}

export async function addFamilyAction(slug: string, clientId: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const raw = formObject(fd);
  const res = await run(async () => {
    assertCan(ctx, 'client.write');
    await clients.addFamilyMember(scopeOf(ctx), clientId, { ...raw, relation: raw.relation as 'SPOUSE', included: raw.included === 'on' });
  });
  refresh(slug);
  return res;
}

export async function removeFamilyAction(slug: string, memberId: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'client.write');
    await clients.removeFamilyMember(scopeOf(ctx), memberId);
  });
  refresh(slug);
  return res;
}

// ─── Cases ──────────────────────────────────────────────────────────────────

export async function openCaseAction(slug: string, clientId: string, _: Prev, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx(slug);
  const productId = String(fd.get('productId') ?? '');
  const res = await run(async () => {
    assertCan(ctx, 'case.write');
    if (!productId) throw new UserError('Choose a visa product');
    return cases.openCase(scopeOf(ctx), { clientId, productId, ownerId: String(fd.get('ownerId') ?? '') || null });
  });
  if (res.ok && res.data) {
    refresh(slug);
    redirect(`/${slug}/cases/${res.data.id}`);
  }
  return res;
}

export async function moveStageAction(slug: string, caseId: string, toKey: string, override?: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'case.write');
    await cases.moveStage(scopeOf(ctx), caseId, toKey, { override, canOverride: can(ctx.role, 'settings.manage') });
  });
  refresh(slug);
  return res;
}

export async function setCaseStatusAction(
  slug: string,
  caseId: string,
  status: CaseStatus,
  outcome?: CaseOutcome,
  closing?: { reason?: string; rating?: number; comment?: string },
) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'case.write');
    await cases.setCaseStatus(scopeOf(ctx), caseId, status, outcome, closing);
  });
  refresh(slug);
  return res;
}

export async function updateCaseDetailsAction(slug: string, caseId: string, dateKeys: string[], _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'case.write');
    const dates = Object.fromEntries(dateKeys.map((k) => [k, String(fd.get(`date_${k}`) ?? '') || null]));
    await cases.updateCaseDetails(scopeOf(ctx), caseId, {
      ownerId: String(fd.get('ownerId') ?? '') || null,
      // Only when the form shows a branch picker (agencies with more than one branch).
      ...(fd.has('branchId') ? { branchId: String(fd.get('branchId')) || null } : {}),
      dates,
    });
  }, 'Saved');
  refresh(slug);
  return res;
}

// ─── Tasks, appointments, notes ─────────────────────────────────────────────

export async function createTaskAction(slug: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'task.write');
    await work.createTask(scopeOf(ctx), formObject(fd));
  });
  refresh(slug);
  return res;
}

export async function toggleTaskAction(slug: string, taskId: string, done: boolean) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'task.write');
    await work.toggleTask(scopeOf(ctx), taskId, done);
  });
  refresh(slug);
  return res;
}

export async function deleteTaskAction(slug: string, taskId: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'task.write');
    await work.deleteTask(scopeOf(ctx), taskId);
  });
  refresh(slug);
  return res;
}

export async function createAppointmentAction(slug: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'task.write');
    await work.createAppointment(scopeOf(ctx), formObject(fd) as never, { outsideHours: can(ctx.role, 'settings.manage') });
  });
  refresh(slug);
  return res;
}

export async function rescheduleAppointmentAction(slug: string, id: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'task.write');
    await work.rescheduleAppointment(scopeOf(ctx), id, formObject(fd), { outsideHours: can(ctx.role, 'settings.manage') });
  }, 'Appointment moved');
  refresh(slug);
  return res;
}

export async function setAppointmentStatusAction(
  slug: string,
  id: string,
  status: 'SCHEDULED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED',
) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'task.write');
    await work.setAppointmentStatus(scopeOf(ctx), id, status);
  });
  refresh(slug);
  return res;
}

export async function addNoteAction(slug: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    await work.addNote(scopeOf(ctx), formObject(fd));
  });
  refresh(slug);
  return res;
}

// ─── Walk-ins ───────────────────────────────────────────────────────────────

export async function setCheckInStatusAction(slug: string, id: string, status: 'WAITING' | 'WITH_STAFF' | 'DONE' | 'LEFT') {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'checkin.write');
    await checkins.setCheckInStatus(scopeOf(ctx), id, status);
  });
  refresh(slug);
  return res;
}

export async function staffCheckInAction(slug: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'checkin.write');
    await checkins.checkIn(scopeOf(ctx), formObject(fd) as never);
  }, 'Added to the queue');
  refresh(slug);
  return res;
}

// ─── Team & settings ────────────────────────────────────────────────────────

export async function inviteAction(slug: string, _: Prev, fd: FormData): Promise<ActionResult<{ link: string }>> {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'team.manage');
    const invite = await team.createInvite(scopeOf(ctx), formObject(fd) as never);
    const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    return { link: `${base}/invite/${slug}/${invite.token}` };
  });
  refresh(slug);
  return res;
}

export async function revokeInviteAction(slug: string, inviteId: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'team.manage');
    await team.revokeInvite(scopeOf(ctx), inviteId);
  });
  refresh(slug);
  return res;
}

export async function updateMemberAction(slug: string, userId: string, patch: { role?: Role; active?: boolean }) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'team.manage');
    if (patch.role === 'OWNER' && ctx.role !== 'OWNER') throw new UserError('Only an owner can make someone an owner');
    await team.updateMember(scopeOf(ctx), userId, patch);
  });
  refresh(slug);
  return res;
}

export async function setMemberHoursAction(slug: string, userId: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'team.manage');
    await team.setMemberHours(scopeOf(ctx), userId, { ...formObject(fd), days: fd.getAll('days').map(String) } as never);
  }, 'Working hours saved');
  refresh(slug);
  return res;
}

export async function updateGeneralAction(slug: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    await settings.updateGeneral(scopeOf(ctx), formObject(fd) as never);
  }, 'Settings saved');
  refresh(slug);
  return res;
}

export async function rotateFormKeyAction(slug: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    await settings.rotateFormKey(scopeOf(ctx));
  });
  refresh(slug);
  return res;
}

export async function updateProductAction(slug: string, productId: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const raw = formObject(fd);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    await settings.updateProduct(scopeOf(ctx), productId, { ...raw, active: raw.active === 'on' } as never);
  }, 'Workflow saved');
  refresh(slug);
  return res;
}

export async function updateCaseExtrasAction(slug: string, caseId: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'case.write');
    await cases.updateCaseExtras(scopeOf(ctx), caseId, formObject(fd));
  }, 'Saved');
  refresh(slug);
  return res;
}

export async function setTrackAction(slug: string, caseId: string, key: string, status: (typeof cases.TRACK_STATUSES)[number]) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'case.write');
    await cases.setTrack(scopeOf(ctx), caseId, key, status);
  });
  refresh(slug);
  return res;
}

export async function setCasePackageAction(slug: string, caseId: string, packageId: string | null) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'billing.write');
    await cases.setCasePackage(scopeOf(ctx), caseId, packageId);
  });
  refresh(slug);
  return res;
}

export async function updateClientPackAction(slug: string, clientId: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'client.write');
    await clients.updateClientPack(scopeOf(ctx), clientId, packRaw(fd) ?? {});
  }, 'Profile saved');
  refresh(slug);
  return res;
}

// ─── Workflow library ───────────────────────────────────────────────────────

export async function adoptPathwayAction(slug: string, key: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    await workflows.adoptPathway(scopeOf(ctx), key);
  }, 'Workflow added');
  refresh(slug);
  return res;
}

export async function createCustomWorkflowAction(slug: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    return (await workflows.createCustomWorkflow(scopeOf(ctx), formObject(fd) as never)).id;
  });
  refresh(slug);
  if (res.ok && res.data) redirect(`/${slug}/settings?tab=workflows&product=${res.data}`);
  return res;
}

export async function applyLibraryUpdateAction(slug: string, productId: string, keepStages: boolean) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    await workflows.applyLibraryUpdate(scopeOf(ctx), productId, { keepStages });
  }, 'Updated from the library');
  refresh(slug);
  return res;
}

// ─── Portal logins (vault) ──────────────────────────────────────────────────

export async function saveVaultAction(slug: string, clientId: string, id: string | null, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'client.write');
    await vault.saveVaultEntry(scopeOf(ctx), clientId, formObject(fd) as never, id ?? undefined);
  }, 'Saved');
  refresh(slug);
  return res;
}

export async function revealVaultAction(slug: string, id: string) {
  const ctx = await getCtx(slug);
  return run(async () => {
    assertCan(ctx, 'vault.reveal');
    return vault.revealVaultEntry(scopeOf(ctx), id);
  });
}

export async function deleteVaultAction(slug: string, id: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'client.write');
    await vault.deleteVaultEntry(scopeOf(ctx), id);
  });
  refresh(slug);
  return res;
}

// ─── Document templates ─────────────────────────────────────────────────────

export async function previewDocumentAction(slug: string, caseId: string, templateId: string) {
  const ctx = await getCtx(slug);
  return run(async () => {
    assertCan(ctx, 'document.write');
    return docTemplates.previewDocument(scopeOf(ctx), caseId, templateId, ctx.tenant.name);
  });
}

/** `body`: the text as staff edited it in the preview; omitted, the template is filled in as is. */
export async function generateDocumentAction(slug: string, caseId: string, templateId: string, body?: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'document.write');
    const r = await docTemplates.generateDocument(scopeOf(ctx), caseId, templateId, ctx.tenant.name, body);
    return r.missing;
  });
  refresh(slug);
  return res;
}

export async function saveTemplateAction(slug: string, id: string | null, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const raw = formObject(fd);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    await docTemplates.saveTemplate(scopeOf(ctx), id, { ...raw, signature: raw.signature === 'on', active: raw.active === 'on' } as never);
  }, 'Template saved');
  refresh(slug);
  return res;
}

// ─── Lists & pack fields ────────────────────────────────────────────────────

export async function addOwnItemAction(slug: string, type: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    await lists.addOwnItem(scopeOf(ctx), { ...formObject(fd), type } as never);
  }, 'Added');
  refresh(slug);
  return res;
}

export async function setLibraryHiddenAction(slug: string, type: string, key: string, hidden: boolean) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    await lists.setLibraryHidden(scopeOf(ctx), type, key, hidden);
  });
  refresh(slug);
  return res;
}

export async function setFieldHiddenAction(slug: string, entity: 'leads' | 'clients' | 'cases', key: string, hidden: boolean) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    await lists.setFieldHidden(scopeOf(ctx), entity, key, hidden);
  });
  refresh(slug);
  return res;
}

export async function sendQuestionnaireAction(slug: string, clientId: string, key: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'client.write');
    await intake.sendQuestionnaire(scopeOf(ctx), clientId, key);
  }, 'Sent to the client portal');
  refresh(slug);
  return res;
}

export async function markNotificationsReadAction(slug: string, id?: string) {
  const ctx = await getCtx(slug);
  const res = await run(() => notifications.markRead(scopeOf(ctx), ctx.user.id, id));
  refresh(slug);
  return res;
}

// ─── Automations (rules engine) ─────────────────────────────────────────────

export async function saveRuleAction(slug: string, id: string | null, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const raw = formObject(fd);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    let actions: unknown;
    let conditions: unknown;
    try {
      actions = JSON.parse(raw.actions ?? '[]');
      conditions = JSON.parse(raw.conditions ?? '{}');
    } catch {
      throw new UserError('Could not read the rule');
    }
    return rules.saveRule(scopeOf(ctx), id, { name: raw.name, trigger: raw.trigger, conditions, actions, active: raw.active === 'on' } as never);
  }, 'Automation saved');
  refresh(slug);
  return res;
}

export async function deleteRuleAction(slug: string, id: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    await rules.deleteRule(scopeOf(ctx), id);
  });
  refresh(slug);
  return res;
}
