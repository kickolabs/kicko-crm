import 'server-only';
import { createHash } from 'node:crypto';
import { prisma, type Prisma } from '@kicko/db';
import { z } from 'zod';
import { countryName } from '@/lib/countries';
import { fmtDate, fullName } from '@/lib/format';
import { BLANK, blocksOf, renderTemplate, type MergeData } from '@/lib/merge';
import { formatMoney } from '@/lib/money';
import { audit } from './audit';
import { tenantPack } from './library';
import { documentPdf } from './pdf';
import { inTenant, logActivity, UserError, type Scope } from './scope';
import { newKey, putObject } from './storage';

// Agreements and letters generated from templates with merge fields. A generated
// document keeps the exact text it was created with; signing records the signer's
// typed name, time, IP and a SHA-256 fingerprint of that text, and stores the signed PDF.

/** The workspace's templates; the pack's starters are added the first time. */
export async function listTemplates(scope: Scope) {
  const rows = await inTenant(scope, (tx) => tx.docTemplate.findMany({ orderBy: [{ kind: 'asc' }, { name: 'asc' }] }));
  if (rows.length) return rows;
  const { pack } = await tenantPack(scope);
  const seeds = pack.documentTemplates?.() ?? [];
  if (!seeds.length) return rows;
  await inTenant(scope, (tx) =>
    tx.docTemplate.createMany({ data: seeds.map((t) => ({ tenantId: scope.tenantId, packId: pack.id, key: t.key, name: t.name, kind: t.kind, signature: t.signature, body: t.body })) }),
  );
  return inTenant(scope, (tx) => tx.docTemplate.findMany({ orderBy: [{ kind: 'asc' }, { name: 'asc' }] }));
}

export const templateInput = z.object({
  name: z.string().trim().min(2, 'Name the template').max(120),
  kind: z.enum(['agreement', 'letter', 'form']),
  signature: z.boolean(),
  body: z.string().trim().min(10, 'Write the template').max(40_000),
  active: z.boolean().default(true),
});

export async function saveTemplate(scope: Scope, id: string | null, raw: z.input<typeof templateInput>) {
  const input = templateInput.parse(raw);
  const t = await inTenant(scope, (tx) =>
    id ? tx.docTemplate.update({ where: { id }, data: input }) : tx.docTemplate.create({ data: { tenantId: scope.tenantId, ...input } }),
  );
  await audit(scope, 'settings.template', `${id ? 'Updated' : 'Created'} template ${input.name}`);
  return t.id;
}

/** Everything a template can merge for a case. */
export async function mergeDataFor(scope: Scope, caseId: string, agencyName: string): Promise<MergeData> {
  const c = await inTenant(scope, (tx) =>
    tx.case.findUnique({
      where: { id: caseId },
      include: { client: true, product: true, documents: { where: { required: true, status: 'PENDING' }, select: { name: true } }, invoices: { where: { status: { not: 'VOID' } }, orderBy: { createdAt: 'desc' }, take: 1, include: { items: { orderBy: { sortOrder: 'asc' } }, installments: { orderBy: { sortOrder: 'asc' } } } } },
    }),
  );
  if (!c) throw new UserError('Case not found');
  const owner = c.ownerId ? await prisma.user.findUnique({ where: { id: c.ownerId }, select: { name: true } }) : null;
  const pkg = c.packageId ? await inTenant(scope, (tx) => tx.servicePackage.findUnique({ where: { id: c.packageId! } })) : null;
  const inv = c.invoices[0];
  const billing = scope.settings.billing ?? {};
  return {
    today: fmtDate(new Date(), scope.timezone),
    agency: { name: billing.legalName ?? agencyName, address: billing.address?.replace(/\n/g, ', '), gstin: billing.gstin },
    client: {
      fullName: fullName(c.client), firstName: c.client.firstName, email: c.client.email, phone: c.client.phone,
      passportNumber: c.client.passportNumber, nationality: c.client.nationality, address: c.client.address?.replace(/\n/g, ', '),
    },
    case: { ref: c.ref, workflow: c.product.name, country: countryName(c.product.country), owner: owner?.name },
    fees: feesOf(inv, pkg, scope.timezone),
    documents: { missing: c.documents.map((d) => d.name) },
  };
}

type FeeInvoice = {
  total: number; taxTotal: number; amountPaid: number; currency: string;
  items: { description: string; quantity: number; amount: number }[];
  installments: { label: string; amount: number; dueDate: Date }[];
};

/**
 * Fees for templates: the case's latest invoice if it has one, otherwise its service
 * package. `lines` and `instalments` are "- " lists, so a field on its own line in a
 * template becomes a list in the document.
 */
export function feesOf(inv: FeeInvoice | undefined, pkg: { name: string; price: number; taxRate?: number; plan: unknown } | null, tz: string) {
  if (inv) {
    const m = (n: number) => formatMoney(n, inv.currency);
    const lines = inv.items.map((i) => `- ${i.description}${i.quantity > 1 ? ` × ${i.quantity}` : ''}: ${m(i.amount)}`);
    if (inv.taxTotal) lines.push(`- GST: ${m(inv.taxTotal)}`);
    return {
      total: m(inv.total),
      package: pkg?.name,
      lines: lines.join('\n'),
      instalments: inv.installments.length
        ? inv.installments.map((p) => `- ${p.label}: ${m(p.amount)}, due ${fmtDate(p.dueDate, tz)}`).join('\n')
        : `- In full: ${m(inv.total)}`,
      paid: m(inv.amountPaid),
      balance: m(inv.total - inv.amountPaid),
    };
  }
  if (!pkg) return {};
  // Package prices are before tax (taxRate in basis points).
  const tax = Math.round((pkg.price * (pkg.taxRate ?? 0)) / 10_000);
  const total = pkg.price + tax;
  const plan = Array.isArray(pkg.plan) ? (pkg.plan as { label: string; percent: number; dueDays: number }[]) : [];
  return {
    total: formatMoney(total),
    package: pkg.name,
    lines: [`- ${pkg.name}: ${formatMoney(pkg.price)}`, ...(tax ? [`- GST: ${formatMoney(tax)}`] : [])].join('\n'),
    instalments: plan.length
      ? plan.map((p) => `- ${p.label}: ${formatMoney(Math.round((total * p.percent) / 100))}, ${p.dueDays ? `due ${p.dueDays} days after signing` : 'on signing'}`).join('\n')
      : `- In full on signing: ${formatMoney(total)}`,
    paid: formatMoney(0),
    balance: formatMoney(total),
  };
}

/** The filled-in text of a template for a case, for staff to check or edit before creating it. */
export async function previewDocument(scope: Scope, caseId: string, templateId: string, agencyName: string) {
  const t = await inTenant(scope, (tx) => tx.docTemplate.findUnique({ where: { id: templateId } }));
  if (!t || !t.active) throw new UserError('Template not found');
  return renderTemplate(t.body, await mergeDataFor(scope, caseId, agencyName));
}

const editedBody = z.string().trim().min(10, 'The document is empty').max(40_000);

/**
 * Create a document on the case from a template (as a PDF), ready to send or sign.
 * `body` is the text staff edited from the preview; without it the template is filled in as it stands.
 */
export async function generateDocument(scope: Scope, caseId: string, templateId: string, agencyName: string, body?: string) {
  const t = await inTenant(scope, (tx) => tx.docTemplate.findUnique({ where: { id: templateId } }));
  if (!t || !t.active) throw new UserError('Template not found');
  const filled = body === undefined ? renderTemplate(t.body, await mergeDataFor(scope, caseId, agencyName)) : null;
  const text = filled ? filled.text : editedBody.parse(body);
  // Edited text: report blanks still left in it.
  const missing = filled ? filled.missing : text.includes(BLANK) ? ['the blanks (________) left in the text'] : [];
  const pdf = await documentPdf({ agency: { name: agencyName, ...(scope.settings.billing ?? {}) }, title: t.name, blocks: blocksOf(text), tz: scope.timezone });
  const key = newKey(scope.tenantId, 'generated', 'application/pdf');
  await putObject(key, pdf, 'application/pdf');
  const doc = await inTenant(scope, async (tx) => {
    const c = await tx.case.findUnique({ where: { id: caseId } });
    if (!c) throw new UserError('Case not found');
    const d = await tx.document.create({
      data: {
        tenantId: scope.tenantId, caseId, clientId: c.clientId, name: t.name, group: t.kind === 'agreement' ? 'Agreements' : 'Letters',
        required: t.signature, status: t.signature ? 'PENDING' : 'UPLOADED', templateId: t.id, body: text,
        signature: t.signature ? ({ requestedAt: new Date().toISOString() } as Prisma.InputJsonValue) : undefined,
        files: { create: { tenantId: scope.tenantId, storageKey: key, fileName: `${t.name}.pdf`, contentType: 'application/pdf', size: pdf.length, uploadedBy: scope.actorId } },
      },
    });
    await logActivity(tx, scope, { type: 'DOCUMENT', summary: `${t.name} generated${filled ? '' : ' (edited before sending)'}${t.signature ? ' and sent for signature' : ''}`, caseId, clientId: c.clientId });
    return d;
  });
  return { id: doc.id, missing };
}

export const signInput = z.object({
  name: z.string().trim().min(3, 'Type your full name').max(120),
  agree: z.literal(true, { error: 'Tick the box to confirm' }),
});

/**
 * The client signs a generated document from the portal: typed full name, time, IP,
 * browser and a SHA-256 fingerprint of the exact text. The signed PDF replaces the draft.
 */
export async function signDocument(scope: Scope, o: { clientId: string; documentId: string; ip: string | null; userAgent: string | null; agencyName: string }, raw: unknown) {
  const input = signInput.parse(raw);
  const d = await inTenant(scope, (tx) => tx.document.findFirst({ where: { id: o.documentId, clientId: o.clientId } }));
  if (!d?.body || !d.signature) throw new UserError('This document is not waiting for a signature');
  const sig = d.signature as { requestedAt: string; signedAt?: string };
  if (sig.signedAt) throw new UserError('Already signed');
  const hash = createHash('sha256').update(d.body).digest('hex');
  const at = new Date().toISOString();
  const pdf = await documentPdf({
    agency: { name: o.agencyName, ...(scope.settings.billing ?? {}) },
    title: d.name,
    blocks: blocksOf(d.body),
    signature: { name: input.name, at, ip: o.ip, hash },
    tz: scope.timezone,
  });
  const key = newKey(scope.tenantId, 'generated', 'application/pdf');
  await putObject(key, pdf, 'application/pdf');
  await inTenant(scope, async (tx) => {
    await tx.document.update({
      where: { id: d.id },
      data: {
        status: 'UPLOADED',
        signature: { ...sig, signedAt: at, name: input.name, ip: o.ip, userAgent: o.userAgent?.slice(0, 300) ?? null, hash } as Prisma.InputJsonValue,
        files: { create: { tenantId: scope.tenantId, storageKey: key, fileName: `${d.name} (signed).pdf`, contentType: 'application/pdf', size: pdf.length, uploadedBy: null } },
      },
    });
    await logActivity(tx, { ...scope, actorId: null }, { type: 'DOCUMENT', summary: `${d.name} signed by ${input.name}`, caseId: d.caseId, clientId: d.clientId });
  });
  await audit({ tenantId: scope.tenantId, actorId: null }, 'document.signed', `${d.name} signed by ${input.name}`, { documentId: d.id, hash, ip: o.ip });
}
