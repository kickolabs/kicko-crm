import 'server-only';
import { after } from 'next/server';
import { checkDocumentFile } from './doc-checks';
import type { DocumentStatus, Tx } from '@kicko/db';
import type { ChecklistItem } from '@kicko/packs';
import { checklistOf } from '@/lib/workflow';
import { z } from 'zod';
import { parseLocal } from '@/lib/format';
import { audit } from './audit';
import { inTenant, logActivity, UserError, type Scope } from './scope';
import { recordFeedback, scrub } from './ai/feedback';
import { ALLOWED_TYPES, MAX_UPLOAD_BYTES, createDownloadUrl, createUploadUrl, newKey, objectSize } from './storage';

/** Make sure every checklist item of the case's product has a Document row. Idempotent. */
export async function syncChecklistTx(tx: Tx, scope: Scope, caseId: string) {
  const c = await tx.case.findUnique({ where: { id: caseId }, include: { product: true } });
  if (!c) return;
  // The case's own checklist (its snapshot), falling back to the product's for older cases.
  const checklist: ChecklistItem[] = checklistOf(c);
  await tx.document.createMany({
    data: checklist.map((item, i) => ({
      tenantId: scope.tenantId,
      caseId,
      clientId: c.clientId,
      checklistKey: item.key,
      name: item.name,
      group: item.group,
      required: item.required,
      sortOrder: i,
    })),
    skipDuplicates: true,
  });
}

export function syncChecklist(scope: Scope, caseId: string) {
  return inTenant(scope, (tx) => syncChecklistTx(tx, scope, caseId));
}

export const requestInput = z.object({
  name: z.string().trim().min(2, 'Name the document').max(160),
  group: z.string().trim().max(60).optional().transform((v) => v || 'Additional'),
  required: z.boolean().default(true),
});

/** Ad-hoc request, e.g. "Explanation letter for study gap". */
export async function requestDocument(scope: Scope, caseId: string, raw: unknown) {
  const input = requestInput.parse(raw);
  return inTenant(scope, async (tx) => {
    const c = await tx.case.findUnique({ where: { id: caseId } });
    if (!c) throw new UserError('Case not found');
    const count = await tx.document.count({ where: { caseId } });
    const doc = await tx.document.create({
      data: { tenantId: scope.tenantId, caseId, clientId: c.clientId, name: input.name, group: input.group, required: input.required, sortOrder: count },
    });
    await logActivity(tx, scope, { type: 'DOC_REQUESTED', summary: `Requested: ${input.name}`, caseId, clientId: c.clientId });
    return doc;
  });
}

const uploadInput = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().refine((t) => t in ALLOWED_TYPES, 'Upload a PDF, image or Word document'),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES, 'Files must be 20 MB or smaller'),
});

/** Step 1: reserve a storage key and get a short-lived upload URL. */
export async function startUpload(scope: Scope, documentId: string, raw: unknown) {
  const input = uploadInput.parse(raw);
  await inTenant(scope, async (tx) => {
    const doc = await tx.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new UserError('Document not found');
    if (doc.status === 'VERIFIED') throw new UserError('This document is verified. Reject it first to replace the file.');
  });
  const key = newKey(scope.tenantId, 'documents', input.contentType);
  const target = await createUploadUrl(key, input.contentType, input.size);
  return { key, ...target };
}

/** Step 2: after the browser uploaded the bytes, record the file (only if it really landed in storage). */
export async function finishUpload(scope: Scope, documentId: string, raw: unknown) {
  const input = uploadInput.extend({ key: z.string() }).parse(raw);
  if (!input.key.startsWith(`tenants/${scope.tenantId}/documents/`)) throw new UserError('Invalid upload');
  const size = await objectSize(input.key);
  if (size == null) throw new UserError('Upload did not complete. Please try again.');
  return inTenant(scope, async (tx) => {
    const doc = await tx.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new UserError('Document not found');
    const file = await tx.documentFile.create({
      data: {
        tenantId: scope.tenantId,
        documentId,
        storageKey: input.key,
        fileName: input.fileName,
        contentType: input.contentType,
        size,
        uploadedBy: scope.actorId,
      },
    });
    after(() => checkDocumentFile(scope, file.id));
    after(async () => {
      const { emit } = await import('./rules');
      const c = await inTenant(scope, (t) => t.case.findUnique({ where: { id: doc.caseId }, select: { ownerId: true } }));
      await emit(scope, 'DOC_UPLOADED', { recordType: 'case', recordId: doc.caseId, caseId: doc.caseId, clientId: doc.clientId, ownerId: c?.ownerId, values: {}, words: { document: doc.name } });
    });
    await tx.document.update({ where: { id: documentId }, data: { status: 'UPLOADED', rejectionReason: null, verifiedAt: null, verifiedBy: null } });
    await logActivity(tx, scope, {
      type: 'DOC_UPLOADED',
      summary: `Uploaded ${doc.name}${doc.status === 'REJECTED' ? ' (replacement)' : ''}`,
      caseId: doc.caseId,
      clientId: doc.clientId,
    });
  });
}

export const reviewInput = z
  .object({
    decision: z.enum(['VERIFIED', 'REJECTED']),
    reason: z.string().trim().max(500).optional(),
    expiresAt: z.string().optional(),
  })
  .refine((v) => v.decision === 'VERIFIED' || (v.reason && v.reason.length > 2), {
    message: 'Tell the client what to fix',
    path: ['reason'],
  });

export async function reviewDocument(scope: Scope, documentId: string, raw: unknown) {
  const input = reviewInput.parse(raw);
  const doc = await reviewTx(scope, documentId, input);
  if (input.decision === 'REJECTED') {
    const { fireAutomation } = await import('./whatsapp/automations');
    await fireAutomation(scope, 'DOC_REJECTED', {
      clientId: doc.clientId,
      caseId: doc.caseId,
      vars: [doc.client.firstName, doc.name, input.reason ?? ''],
    });
    const { emit } = await import('./rules');
    const c = await inTenant(scope, (tx) => tx.case.findUnique({ where: { id: doc.caseId }, select: { ownerId: true } }));
    await emit(scope, 'DOC_REJECTED', {
      recordType: 'case', recordId: doc.caseId, caseId: doc.caseId, clientId: doc.clientId, ownerId: c?.ownerId, values: {},
      words: { firstName: doc.client.firstName, name: [doc.client.firstName, doc.client.lastName].filter(Boolean).join(' '), document: doc.name, reason: input.reason ?? '' },
    });
  }
}

function reviewTx(scope: Scope, documentId: string, input: z.infer<typeof reviewInput>) {
  return inTenant(scope, async (tx) => {
    const doc = await tx.document.findUnique({ where: { id: documentId }, include: { files: { orderBy: { createdAt: 'desc' }, take: 1 }, client: true } });
    if (!doc) throw new UserError('Document not found');
    if (!doc.files.length) throw new UserError('Nothing uploaded yet');
    const verified = input.decision === 'VERIFIED';
    await tx.document.update({
      where: { id: documentId },
      data: {
        status: input.decision,
        rejectionReason: verified ? null : input.reason,
        verifiedBy: verified ? scope.actorId : null,
        verifiedAt: verified ? new Date() : null,
        expiresAt: input.expiresAt ? parseLocal(input.expiresAt, 'UTC') : doc.expiresAt,
      },
    });
    await logActivity(tx, scope, {
      type: verified ? 'DOC_VERIFIED' : 'DOC_REJECTED',
      summary: verified ? `Verified ${doc.name}` : `Rejected ${doc.name}: ${input.reason}`,
      caseId: doc.caseId,
      clientId: doc.clientId,
    });
    // Did the person agree with Kicko Yu's check? (Only with the agency's opt-in.)
    const file = doc.files[0]!;
    const check = file.aiStatus === 'done' ? (file.aiCheck as { documentType?: string; matchesExpected?: string; legible?: boolean; issues?: { severity: string; message: string }[] } | null) : null;
    if (check) {
      const names = [doc.client.firstName, doc.client.lastName];
      const flagged = (check.issues ?? []).some((i) => i.severity === 'high');
      await recordFeedback(tx, scope, {
        task: 'document_check',
        subjectId: file.id,
        output: {
          requested: scrub(doc.name, names),
          documentType: scrub(check.documentType ?? '', names),
          matchesExpected: check.matchesExpected ?? null,
          legible: check.legible ?? null,
          issues: (check.issues ?? []).map((i) => ({ severity: i.severity, message: scrub(i.message, names) })),
        },
        outcome: { decision: input.decision, reason: input.reason ? scrub(input.reason, names) : null },
        agreed: verified ? !flagged : flagged,
      });
    }
    return doc;
  });
}

export async function setDocumentStatus(scope: Scope, documentId: string, status: Extract<DocumentStatus, 'NOT_APPLICABLE' | 'PENDING'>) {
  return inTenant(scope, async (tx) => {
    const doc = await tx.document.findUnique({ where: { id: documentId }, include: { files: { take: 1 } } });
    if (!doc) throw new UserError('Document not found');
    const next = status === 'PENDING' && doc.files.length ? 'UPLOADED' : status;
    await tx.document.update({ where: { id: documentId }, data: { status: next, rejectionReason: null } });
  });
}

export async function setDocumentExpiry(scope: Scope, documentId: string, date: string | null) {
  return inTenant(scope, async (tx) => {
    const res = await tx.document.updateMany({ where: { id: documentId }, data: { expiresAt: date ? parseLocal(date, 'UTC') : null } });
    if (!res.count) throw new UserError('Document not found');
  });
}

/** Signed URL for a file; the lookup runs under RLS so foreign files are never resolvable. */
export async function fileUrl(scope: Scope, fileId: string, inline: boolean) {
  const file = await inTenant(scope, (tx) =>
    tx.documentFile.findUnique({ where: { id: fileId }, include: { document: { select: { name: true, client: { select: { ref: true, firstName: true, lastName: true } } } } } }),
  );
  if (!file) throw new UserError('File not found');
  // Who opened which client document (passports etc.), for the agency's audit log.
  const c = file.document.client;
  await audit(scope, 'document.viewed', `${inline ? 'Viewed' : 'Downloaded'} ${file.document.name} of ${c.ref} ${[c.firstName, c.lastName].filter(Boolean).join(' ')}`, { fileId, fileName: file.fileName });
  return createDownloadUrl(file.storageKey, file.fileName, inline);
}
