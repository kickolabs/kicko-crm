import 'server-only';
import { audit } from './audit';
import { after } from 'next/server';
import { checkDocumentFile } from './doc-checks';
import { prisma, withTenant } from '@kicko/db';
import type { TenantSettings } from '@kicko/db/provision';
import { z } from 'zod';
import { parseLocal, toLocalInput } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { bookingStaff, bookSlot, DEFAULT_BOOKING, openSlots } from './booking';
import { stagesOf } from './cases';
import { createLinkForInvoice } from './payment-links';
import type { PortalCtx } from './portal-auth';
import { logActivity, UserError } from './scope';
import { ALLOWED_TYPES, MAX_UPLOAD_BYTES, createDownloadUrl, createUploadUrl, newKey, objectSize } from './storage';

// Everything a client can see or do in their portal. Every query is pinned to
// p.client.id on top of tenant RLS, so one client can never reach another's data.

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const run = <T>(p: PortalCtx, fn: Parameters<typeof withTenant<T>>[1]) => withTenant(p.scope.tenantId, fn);

export const DEFAULT_PORTAL = DEFAULT_BOOKING;

export type TimelineEvent = { at: Date; kind: 'stage' | 'doc' | 'payment' | 'appointment' | 'case'; text: string; tone?: 'ok' | 'warn' };

export async function getPortalHome(p: PortalCtx) {
  const clientId = p.client.id;
  const data = await run(p, async (tx) => {
    const [cases, invoices, appointments, unread] = await Promise.all([
      tx.case.findMany({
        where: { clientId },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        include: {
          product: true,
          history: { orderBy: { at: 'asc' } },
          documents: {
            where: { status: { not: 'NOT_APPLICABLE' } },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            include: { files: { orderBy: { createdAt: 'desc' }, take: 1 } },
          },
        },
      }),
      tx.invoice.findMany({
        where: { clientId, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] } },
        orderBy: { issueDate: 'desc' },
        include: { installments: { orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }] }, payments: { orderBy: { paidAt: 'desc' } } },
      }),
      tx.appointment.findMany({ where: { clientId, startsAt: { gte: new Date() }, status: 'SCHEDULED' }, orderBy: { startsAt: 'asc' }, take: 5 }),
      tx.message.count({ where: { clientId, channel: 'PORTAL', direction: 'OUTBOUND', readAt: null } }),
    ]);
    return { cases, invoices, appointments, unread };
  });

  const counsellor = p.client.ownerId
    ? await prisma.user.findUnique({ where: { id: p.client.ownerId }, select: { name: true } })
    : null;

  // Client-safe timeline: stage moves, document decisions, payments. No internal notes.
  const events: TimelineEvent[] = [];
  for (const c of data.cases) {
    const stages = stagesOf(c);
    events.push({ at: c.createdAt, kind: 'case', text: `${c.product.name} case opened` });
    for (const h of c.history) {
      if (!h.fromKey) continue;
      events.push({ at: h.at, kind: 'stage', text: `Moved to ${stages.find((s) => s.key === h.toKey)?.name ?? h.toKey}` });
    }
    for (const d of c.documents) {
      if (d.status === 'VERIFIED' && d.verifiedAt) events.push({ at: d.verifiedAt, kind: 'doc', text: `${d.name} verified`, tone: 'ok' });
      if (d.status === 'REJECTED') events.push({ at: d.updatedAt, kind: 'doc', text: `${d.name} needs another upload`, tone: 'warn' });
    }
  }
  for (const inv of data.invoices) for (const pay of inv.payments) events.push({ at: pay.paidAt, kind: 'payment', text: `Payment received · ${formatMoney(pay.amount, inv.currency)}`, tone: 'ok' });
  events.sort((a, b) => b.at.getTime() - a.at.getTime());

  return { ...data, counsellor: counsellor?.name ?? null, events: events.slice(0, 15) };
}

// ── Documents ───────────────────────────────────────────────────────────────

async function ownDocument(p: PortalCtx, documentId: string) {
  const doc = await run(p, (tx) => tx.document.findFirst({ where: { id: documentId, clientId: p.client.id }, include: { case: true } }));
  if (!doc) throw new UserError('Document not found');
  if (doc.case.status === 'CLOSED') throw new UserError('This case is closed');
  if (doc.status === 'VERIFIED') throw new UserError('Already verified. Nothing more needed.');
  return doc;
}

const fileInput = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().refine((t) => t in ALLOWED_TYPES, 'Please upload a PDF, photo or Word document'),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES, 'Files must be 20 MB or smaller'),
});

export async function portalStartUpload(p: PortalCtx, documentId: string, raw: unknown) {
  const input = fileInput.parse(raw);
  await ownDocument(p, documentId);
  const key = newKey(p.scope.tenantId, 'documents', input.contentType);
  return { key, ...(await createUploadUrl(key, input.contentType, input.size)) };
}

export async function portalFinishUpload(p: PortalCtx, documentId: string, raw: unknown) {
  const input = fileInput.extend({ key: z.string() }).parse(raw);
  if (!input.key.startsWith(`tenants/${p.scope.tenantId}/documents/`)) throw new UserError('Invalid upload');
  const doc = await ownDocument(p, documentId);
  const size = await objectSize(input.key);
  if (size == null) throw new UserError('Upload did not finish. Please try again.');
  await run(p, async (tx) => {
    const file = await tx.documentFile.create({
      data: { tenantId: p.scope.tenantId, documentId, storageKey: input.key, fileName: input.fileName, contentType: input.contentType, size, uploadedBy: null },
    });
    after(() => checkDocumentFile(p.scope, file.id));
    await tx.document.update({ where: { id: documentId }, data: { status: 'UPLOADED', rejectionReason: null } });
    await logActivity(tx, p.scope, { type: 'DOC_UPLOADED', summary: `Client uploaded ${doc.name} via portal`, caseId: doc.caseId, clientId: p.client.id });
  });
}

export async function portalFileUrl(p: PortalCtx, fileId: string) {
  const file = await run(p, (tx) => tx.documentFile.findFirst({ where: { id: fileId, document: { clientId: p.client.id } } }));
  if (!file) throw new UserError('File not found');
  await audit({ tenantId: p.scope.tenantId }, 'document.viewed', `Client ${p.client.ref} opened their file ${file.fileName} in the portal`, { fileId });
  return createDownloadUrl(file.storageKey, file.fileName, true);
}

// ── Messages ────────────────────────────────────────────────────────────────

export function portalMessages(p: PortalCtx) {
  return run(p, async (tx) => {
    const messages = await tx.message.findMany({ where: { clientId: p.client.id }, orderBy: { createdAt: 'asc' }, take: 300 });
    await tx.message.updateMany({ where: { clientId: p.client.id, channel: 'PORTAL', direction: 'OUTBOUND', readAt: null }, data: { readAt: new Date() } });
    return messages;
  });
}

export const messageInput = z.object({ body: z.string().trim().min(1, 'Write a message').max(4000) });

export async function portalSendMessage(p: PortalCtx, raw: unknown) {
  const { body } = messageInput.parse(raw);
  return run(p, (tx) =>
    tx.message.create({ data: { tenantId: p.scope.tenantId, clientId: p.client.id, channel: 'PORTAL', direction: 'INBOUND', body } }),
  );
}

// ── Payments ────────────────────────────────────────────────────────────────

export async function portalPayLink(p: PortalCtx, invoiceId: string) {
  const inv = await run(p, (tx) => tx.invoice.findFirst({ where: { id: invoiceId, clientId: p.client.id } }));
  if (!inv) throw new UserError('Invoice not found');
  return createLinkForInvoice(p.scope, inv.id, appUrl());
}

export async function portalOwnsInvoice(p: PortalCtx, invoiceId: string) {
  return Boolean(await run(p, (tx) => tx.invoice.findFirst({ where: { id: invoiceId, clientId: p.client.id, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] } } })));
}

// ── Booking ─────────────────────────────────────────────────────────────────

export async function availableSlots(p: PortalCtx, horizonDays = 14) {
  return openSlots(p.scope, await bookingStaff(p.scope, p.client.ownerId), horizonDays);
}

export const bookInput = z.object({
  startsAt: z.iso.datetime(),
  mode: z.enum(['IN_PERSON', 'VIDEO', 'PHONE']),
  topic: z.string().trim().max(300).optional(),
});

export async function portalBook(p: PortalCtx, raw: unknown) {
  const input = bookInput.parse(raw);
  return bookSlot(p.scope, { contact: { kind: 'client', id: p.client.id }, ownerId: p.client.ownerId, ...input, via: 'portal' });
}

export async function portalCancelAppointment(p: PortalCtx, appointmentId: string) {
  return run(p, async (tx) => {
    const a = await tx.appointment.findFirst({ where: { id: appointmentId, clientId: p.client.id, status: 'SCHEDULED' } });
    if (!a) throw new UserError('Appointment not found');
    if (a.startsAt.getTime() - Date.now() < 2 * 3600_000) throw new UserError('Less than 2 hours to go. Please message your consultant instead.');
    await tx.appointment.update({ where: { id: a.id }, data: { status: 'CANCELLED' } });
    await logActivity(tx, p.scope, { type: 'APPOINTMENT', summary: 'Client cancelled an appointment via portal', clientId: p.client.id, caseId: a.caseId });
  });
}
