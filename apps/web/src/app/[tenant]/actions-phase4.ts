'use server';

import { audit } from '@/server/audit';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formObject, run, type ActionResult } from '@/lib/action';
import { can } from '@/lib/permissions';
import { assertCan, db, getCtx, type Ctx } from '@/lib/tenant';
import { markThreadRead, parseContactKey } from '@/server/messages';
import { createLoginLink } from '@/server/portal-auth';
import { scopeOf, UserError } from '@/server/scope';
import { createDownloadUrl, copyObject, newKey, ALLOWED_TYPES } from '@/server/storage';
import { sandboxOutbox } from '@/integrations/messaging/whatsapp-sandbox';
import * as wa from '@/server/whatsapp/service';
import { assistantSettings, assistantState, describeAssistant } from '@/server/whatsapp/assistant';
import { findByPhone } from '@/server/contacts';
import { normalizePhone } from '@/lib/phone';

type Prev = ActionResult | null;
const refresh = (slug: string) => revalidatePath(`/${slug}`, 'layout');

function assertCanMessage(ctx: Ctx) {
  if (!can(ctx.role, 'client.write') && !can(ctx.role, 'lead.write') && !can(ctx.role, 'billing.write')) {
    throw new UserError("You don't have permission to message contacts");
  }
}

function contactOf(key: string) {
  const c = parseContactKey(key);
  if (!c) throw new UserError('Unknown conversation');
  return c;
}

// ─── Connection ─────────────────────────────────────────────────────────────

export async function syncTemplatesAction(slug: string): Promise<ActionResult<number>> {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    return wa.syncTemplates(scopeOf(ctx));
  });
  refresh(slug);
  return res;
}

// ─── Automations ────────────────────────────────────────────────────────────

const automationInput = z.object({
  trigger: z.enum(['CASE_STAGE', 'DOC_REJECTED', 'INVOICE_ISSUED', 'PAYMENT_OVERDUE', 'PAYMENT_RECEIVED']),
  stageKey: z.string().optional().transform((v) => v || null),
  template: z.string().regex(/^[^|]+\|[^|]+$/, 'Pick a template'),
});

export async function saveAutomationAction(slug: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    const input = automationInput.parse(formObject(fd));
    const [templateName, language] = input.template.split('|') as [string, string];
    await db(ctx, (tx) =>
      tx.automation.create({
        data: { tenantId: ctx.tenant.id, trigger: input.trigger, stageKey: input.trigger === 'CASE_STAGE' ? input.stageKey : null, templateName, language },
      }),
    );
  }, 'Automation added');
  refresh(slug);
  return res;
}

export async function toggleAutomationAction(slug: string, id: string, active: boolean) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    await db(ctx, (tx) => tx.automation.updateMany({ where: { id }, data: { active } }));
  });
  refresh(slug);
  return res;
}

export async function deleteAutomationAction(slug: string, id: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    await db(ctx, (tx) => tx.automation.deleteMany({ where: { id } }));
  });
  refresh(slug);
  return res;
}

// ─── Messaging ──────────────────────────────────────────────────────────────

export async function waSendTextAction(slug: string, key: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCanMessage(ctx);
    await wa.sendText(scopeOf(ctx), contactOf(key), String(fd.get('body') ?? ''));
  });
  refresh(slug);
  return res;
}

export async function waSendTemplateAction(slug: string, key: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCanMessage(ctx);
    const [name, language] = String(fd.get('template') ?? '').split('|');
    if (!name) throw new UserError('Pick a template');
    const params = [...fd.keys()].filter((k) => /^p\d+$/.test(k)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map((k) => String(fd.get(k) ?? ''));
    await wa.sendTemplate(scopeOf(ctx), contactOf(key), name, params, { language });
  });
  refresh(slug);
  return res;
}

export async function setOptInAction(slug: string, key: string, optIn: boolean) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCanMessage(ctx);
    await wa.setOptIn(scopeOf(ctx), contactOf(key), optIn);
  });
  refresh(slug);
  return res;
}

export async function markContactReadAction(slug: string, key: string) {
  const ctx = await getCtx(slug);
  const res = await run(() => markThreadRead(scopeOf(ctx), contactOf(key)));
  refresh(slug);
  return res;
}

export async function waMediaUrlAction(slug: string, messageId: string) {
  const ctx = await getCtx(slug);
  return run(async () => {
    const m = await db(ctx, (tx) => tx.message.findUnique({ where: { id: messageId } }));
    if (!m?.mediaKey) throw new UserError('Attachment not available');
    await audit({ tenantId: ctx.tenant.id, actorId: ctx.user.id }, 'document.viewed', `Opened WhatsApp attachment ${m.mediaName ?? m.mediaType ?? ''}`.trim(), { messageId });
    return createDownloadUrl(m.mediaKey, m.mediaName ?? `whatsapp-${m.mediaType}`, true);
  });
}

/** Copy a WhatsApp attachment into a case document as a new version, ready for review. */
export async function saveMediaToDocumentAction(slug: string, messageId: string, documentId: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'document.write');
    const { m, doc } = await db(ctx, async (tx) => ({
      m: await tx.message.findUnique({ where: { id: messageId } }),
      doc: await tx.document.findUnique({ where: { id: documentId } }),
    }));
    if (!m?.mediaKey || !m.mediaMime) throw new UserError('Attachment not available');
    if (!doc || doc.clientId !== m.clientId) throw new UserError('Pick a document of this client');
    if (doc.status === 'VERIFIED') throw new UserError('That document is already verified');
    const type = m.mediaMime in ALLOWED_TYPES ? m.mediaMime : 'application/pdf';
    const key = newKey(ctx.tenant.id, 'documents', type);
    const size = await copyObject(m.mediaKey, key, type);
    await db(ctx, async (tx) => {
      await tx.documentFile.create({
        data: { tenantId: ctx.tenant.id, documentId, storageKey: key, fileName: m.mediaName ?? `whatsapp.${ALLOWED_TYPES[type]}`, contentType: type, size, uploadedBy: ctx.user.id },
      });
      await tx.document.update({ where: { id: documentId }, data: { status: 'UPLOADED', rejectionReason: null } });
      await tx.activity.create({
        data: { tenantId: ctx.tenant.id, type: 'DOC_UPLOADED', summary: `Saved WhatsApp attachment as ${doc.name}`, actorId: ctx.user.id, caseId: doc.caseId, clientId: doc.clientId },
      });
    });
  }, 'Saved to documents');
  refresh(slug);
  return res;
}

/** Send the client a portal login link via the approved "portal_link" template. */
export async function sendPortalLinkWaAction(slug: string, clientId: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'client.write');
    const scope = scopeOf(ctx);
    const client = await db(ctx, (tx) => tx.client.findUnique({ where: { id: clientId } }));
    if (!client) throw new UserError('Client not found');
    const link = await createLoginLink(scope, slug, clientId);
    await wa.sendTemplate(scope, { kind: 'client', id: clientId }, 'portal_link', [client.firstName, link]);
  }, 'Portal link sent on WhatsApp');
  refresh(slug);
  return res;
}

// ─── Simulator (sandbox) ────────────────────────────────────────────────────

export async function simulateInboundAction(slug: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    const scope = scopeOf(ctx);
    if (!(await wa.messagingStatus(scope))?.sandbox) throw new UserError('Switch to the WhatsApp sandbox to use the simulator');
    const from = String(fd.get('from') ?? '').trim();
    if (!/^\+?\d[\d\s-]{7,}$/.test(from)) throw new UserError('Enter a phone number with country code, e.g. +91 98765 43210');
    const text = String(fd.get('text') ?? '').trim();
    const file = fd.get('file');
    const media = file instanceof File && file.size > 0 ? await wa.sandboxMediaFromUpload(scope, file) : undefined;
    if (!text && !media) throw new UserError('Type a message or attach a file');
    await wa.postSimulated(scope, wa.simulatorPayload({ from, name: String(fd.get('name') ?? '').trim() || undefined, text, media }));
    // Tell the tester whether the AI assistant will answer, and if not, why.
    const contact = await findByPhone(scope, normalizePhone(from, scope.country)!);
    if (!contact) return null;
    const s = await assistantState(scope, contact);
    const cfg = assistantSettings(scope.settings);
    return s.status === 'active' ? `${cfg.name} (AI) will reply in a moment.` : describeAssistant(cfg.name, s, scope.timezone).title + '. ' + describeAssistant(cfg.name, s, scope.timezone).detail;
  }, 'Delivered to your webhook');
  refresh(slug);
  return res;
}

export async function simulateStatusAction(slug: string, messageId: string, status: 'delivered' | 'read' | 'failed') {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    const scope = scopeOf(ctx);
    if (!(await wa.messagingStatus(scope))?.sandbox) throw new UserError('Sandbox only');
    const m = await db(ctx, (tx) => tx.message.findUnique({ where: { id: messageId } }));
    if (!m?.externalId || !m.phone) throw new UserError('Message not sent yet');
    await wa.postSimulated(scope, wa.simulatorPayload({ statusFor: m.externalId, status, to: m.phone }));
  });
  refresh(slug);
  return res;
}

export async function sandboxOutboxAction(slug: string) {
  const ctx = await getCtx(slug);
  assertCan(ctx, 'settings.manage');
  return sandboxOutbox.filter((o) => o.tenantId === ctx.tenant.id).slice(-20).reverse().map((o) => ({ at: o.at.toISOString(), to: o.to, body: JSON.stringify(o.body) }));
}
