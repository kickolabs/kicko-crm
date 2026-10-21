'use server';

import { audit } from '@/server/audit';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma, type ApplicationStatus } from '@kicko/db';
import type { TenantSettings } from '@kicko/db/provision';
import { z } from 'zod';
import { formObject, run, type ActionResult } from '@/lib/action';
import { assertCan, getCtx } from '@/lib/tenant';
import { scopeOf } from '@/server/scope';
import * as docs from '@/server/documents';
import * as billing from '@/server/billing';
import * as links from '@/server/payment-links';
import * as partners from '@/server/partners';

type Prev = ActionResult | null;
const refresh = (slug: string) => revalidatePath(`/${slug}`, 'layout');
const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

// ─── Documents ──────────────────────────────────────────────────────────────

export async function startUploadAction(slug: string, documentId: string, file: { fileName: string; contentType: string; size: number }) {
  const ctx = await getCtx(slug);
  return run(async () => {
    assertCan(ctx, 'document.write');
    return docs.startUpload(scopeOf(ctx), documentId, file);
  });
}

export async function finishUploadAction(
  slug: string,
  documentId: string,
  file: { key: string; fileName: string; contentType: string; size: number },
) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'document.write');
    await docs.finishUpload(scopeOf(ctx), documentId, file);
  });
  refresh(slug);
  return res;
}

export async function reviewDocumentAction(slug: string, documentId: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'document.verify');
    await docs.reviewDocument(scopeOf(ctx), documentId, formObject(fd));
  });
  refresh(slug);
  return res;
}

export async function setDocumentStatusAction(slug: string, documentId: string, status: 'NOT_APPLICABLE' | 'PENDING') {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'document.write');
    await docs.setDocumentStatus(scopeOf(ctx), documentId, status);
  });
  refresh(slug);
  return res;
}

export async function setDocumentExpiryAction(slug: string, documentId: string, date: string | null) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'document.write');
    await docs.setDocumentExpiry(scopeOf(ctx), documentId, date);
  });
  refresh(slug);
  return res;
}

export async function requestDocumentAction(slug: string, caseId: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const raw = formObject(fd);
  const res = await run(async () => {
    assertCan(ctx, 'document.write');
    await docs.requestDocument(scopeOf(ctx), caseId, { ...raw, required: raw.required === 'on' });
  });
  refresh(slug);
  return res;
}

export async function fileUrlAction(slug: string, fileId: string, inline: boolean) {
  const ctx = await getCtx(slug);
  return run(() => docs.fileUrl(scopeOf(ctx), fileId, inline));
}

// ─── Billing ────────────────────────────────────────────────────────────────

const invoiceForm = z.object({ payload: z.string() });

export async function createInvoiceAction(slug: string, _: Prev, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'billing.write');
    const { payload } = invoiceForm.parse(formObject(fd));
    return billing.createInvoice(scopeOf(ctx), JSON.parse(payload));
  });
  if (res.ok && res.data) {
    refresh(slug);
    redirect(`/${slug}/billing/${res.data.id}`);
  }
  return res;
}

export async function setInvoiceStatusAction(slug: string, invoiceId: string, status: 'ISSUED' | 'VOID') {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'billing.write');
    await billing.setInvoiceStatus(scopeOf(ctx), invoiceId, status);
  });
  refresh(slug);
  return res;
}

export async function recordPaymentAction(slug: string, invoiceId: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'billing.write');
    await billing.recordPayment(scopeOf(ctx), invoiceId, formObject(fd));
  }, 'Payment recorded');
  refresh(slug);
  return res;
}

export async function paymentLinkAction(slug: string, invoiceId: string): Promise<ActionResult<string>> {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'billing.write');
    return links.createLinkForInvoice(scopeOf(ctx), invoiceId, appUrl());
  });
  refresh(slug);
  return res;
}

export async function savePackageAction(slug: string, id: string | null, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const raw = formObject(fd);
  const res = await run(async () => {
    assertCan(ctx, 'billing.write');
    await billing.savePackage(scopeOf(ctx), id, { ...raw, active: raw.active === 'on' });
  }, 'Package saved');
  refresh(slug);
  return res;
}

const billingSettingsInput = z.object({
  legalName: z.string().trim().max(160).optional(),
  address: z.string().trim().max(500).optional(),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .refine((v) => !v || /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v), 'GSTIN should look like 33ABCDE1234F1Z5'),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .refine((v) => !v || /^[A-Z]{5}\d{4}[A-Z]$/.test(v), 'PAN should look like ABCDE1234F'),
  invoicePrefix: z.string().trim().max(6).regex(/^[A-Z0-9]*$/i, 'Letters and numbers only').optional(),
  defaultTaxMode: z.enum(['NONE', 'GST_INTRA', 'GST_INTER']),
  upiId: z.string().trim().max(80).optional(),
  bankDetails: z.string().trim().max(500).optional(),
  terms: z.string().trim().max(1000).optional(),
});

export async function saveBillingSettingsAction(slug: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    const input = billingSettingsInput.parse(formObject(fd));
    const settings: TenantSettings = {
      ...ctx.tenant.settings,
      billing: { ...input, invoicePrefix: input.invoicePrefix?.toUpperCase() || 'INV' },
    };
    await prisma.tenant.update({ where: { id: ctx.tenant.id }, data: { settings } });
    await audit({ tenantId: ctx.tenant.id, actorId: ctx.user.id }, 'settings.billing', 'Changed invoice & billing settings');
  }, 'Billing settings saved');
  refresh(slug);
  return res;
}

// ─── Partners ───────────────────────────────────────────────────────────────

export async function saveInstitutionAction(slug: string, id: string | null, _: Prev, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx(slug);
  const raw = formObject(fd);
  const res = await run(async () => {
    assertCan(ctx, 'partners.manage');
    return partners.saveInstitution(scopeOf(ctx), id, { ...raw, active: raw.active !== undefined ? raw.active === 'on' : true });
  }, 'Saved');
  refresh(slug);
  if (res.ok && !id) redirect(`/${slug}/partners/${res.data}`);
  return res;
}

export async function addCourseAction(slug: string, institutionId: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'partners.manage');
    await partners.addCourse(scopeOf(ctx), institutionId, formObject(fd));
  });
  refresh(slug);
  return res;
}

export async function removeCourseAction(slug: string, courseId: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'partners.manage');
    await partners.removeCourse(scopeOf(ctx), courseId);
  });
  refresh(slug);
  return res;
}

export async function addApplicationAction(slug: string, caseId: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'application.write');
    await partners.addApplication(scopeOf(ctx), caseId, formObject(fd));
  });
  refresh(slug);
  return res;
}

export async function setApplicationStatusAction(slug: string, applicationId: string, status: ApplicationStatus) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'application.write');
    await partners.setApplicationStatus(scopeOf(ctx), applicationId, status);
  });
  refresh(slug);
  return res;
}

export async function updateClaimAction(slug: string, claimId: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'commission.manage');
    await partners.updateClaim(scopeOf(ctx), claimId, formObject(fd));
  }, 'Claim updated');
  refresh(slug);
  return res;
}
