import 'server-only';
import { accrueOnPayment } from './sub-agents';
import type { InvoiceStatus, PaymentMethod, Tx } from '@kicko/db';
import { z } from 'zod';
import { parseLocal } from '@/lib/format';
import { allocatePayment, buildInstallments, computeInvoice, formatMoney, parseMoney, type PlanStep } from '@/lib/money';
import { inTenant, logActivity, UserError, type Scope } from './scope';

// ── Numbering ───────────────────────────────────────────────────────────────

/** Indian financial year label for a date: Apr–Mar, e.g. 20 Oct 2026 → "26-27". */
export function financialYear(d: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(d);
  const y = Number(parts.find((p) => p.type === 'year')!.value);
  const m = Number(parts.find((p) => p.type === 'month')!.value);
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

/** Gap-free sequence per financial year (GST rule 46: unique, consecutive, ≤16 chars). */
async function nextDocNumber(tx: Tx, tenantId: string, kind: 'invoice' | 'receipt', prefix: string, fy: string) {
  const row = await tx.counter.upsert({
    where: { tenantId_key: { tenantId, key: `${kind}_${fy}` } },
    create: { tenantId, key: `${kind}_${fy}`, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${prefix}/${fy}/${String(row.value).padStart(4, '0')}`;
}

// ── Packages ────────────────────────────────────────────────────────────────

const money = (label: string) =>
  z.string().transform((v, ctx) => {
    const m = parseMoney(v);
    if (m == null || m < 0) {
      ctx.addIssue({ code: 'custom', message: `Enter a valid ${label}` });
      return z.NEVER;
    }
    return m;
  });

const planInput = z
  .string()
  .default('')
  .transform((text, ctx): PlanStep[] => {
    // One step per line: "Label, percent, due after N days"  e.g. "On signing, 50, 0"
    const steps = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [label, pct, days] = l.split(',').map((s) => s.trim());
        return { label: label ?? '', percent: Number(pct), dueDays: Number(days ?? 0) };
      });
    if (steps.some((s) => !s.label || !Number.isFinite(s.percent) || s.percent <= 0 || !Number.isInteger(s.dueDays) || s.dueDays < 0)) {
      ctx.addIssue({ code: 'custom', message: 'Each line: label, percent, days (e.g. "On signing, 50, 0")' });
      return z.NEVER;
    }
    if (steps.length && Math.abs(steps.reduce((a, s) => a + s.percent, 0) - 100) > 0.001) {
      ctx.addIssue({ code: 'custom', message: 'Percentages must add up to 100' });
      return z.NEVER;
    }
    return steps;
  });

export const packageInput = z.object({
  name: z.string().trim().min(2, 'Name the package').max(120),
  description: z.string().trim().max(1000).optional(),
  productId: z.string().optional().transform((v) => v || null),
  price: money('price'),
  taxRate: z.coerce.number().min(0).max(28).transform((v) => Math.round(v * 100)),
  plan: planInput,
  active: z.boolean().default(true),
});

export async function savePackage(scope: Scope, id: string | null, raw: unknown) {
  const input = packageInput.parse(raw);
  return inTenant(scope, async (tx) => {
    const data = { ...input, description: input.description || null, plan: input.plan };
    if (id) {
      const res = await tx.servicePackage.updateMany({ where: { id }, data });
      if (!res.count) throw new UserError('Package not found');
      return id;
    }
    return (await tx.servicePackage.create({ data: { tenantId: scope.tenantId, ...data } })).id;
  });
}

// ── Invoices ────────────────────────────────────────────────────────────────

export const invoiceInput = z.object({
  clientId: z.string().min(1, 'Choose a client'),
  caseId: z.string().optional().transform((v) => v || null),
  packageId: z.string().optional().transform((v) => v || null),
  issueDate: z.string().min(1, 'Pick a date'),
  taxMode: z.enum(['NONE', 'GST_INTRA', 'GST_INTER']),
  notes: z.string().trim().max(2000).optional(),
  issue: z.boolean().default(true),
  plan: planInput,
  items: z
    .array(
      z.object({
        description: z.string().trim().min(1, 'Describe the item').max(300),
        quantity: z.coerce.number().int().min(1).max(999),
        unitPrice: money('price'),
        taxRate: z.coerce.number().min(0).max(28).transform((v) => Math.round(v * 100)),
      }),
    )
    .min(1, 'Add at least one line'),
});

export async function createInvoice(scope: Scope, raw: unknown) {
  const input = invoiceInput.parse(raw);
  const issueDate = parseLocal(input.issueDate, scope.timezone);
  if (!issueDate) throw new UserError('Invalid date');
  const totals = computeInvoice(input.items, input.taxMode);
  if (totals.total <= 0) throw new UserError('Invoice total must be more than zero');
  const installments = buildInstallments(totals.total, input.plan, issueDate);

  const invoice = await inTenant(scope, async (tx) => {
    const client = await tx.client.findUnique({ where: { id: input.clientId } });
    if (!client) throw new UserError('Client not found');
    if (input.caseId) {
      const c = await tx.case.findUnique({ where: { id: input.caseId } });
      if (!c || c.clientId !== client.id) throw new UserError('That case belongs to another client');
      // An invoice started from a package sets the case's package (for agreements), if it has none.
      if (input.packageId && !c.packageId && (await tx.servicePackage.findUnique({ where: { id: input.packageId } }))) {
        await tx.case.update({ where: { id: c.id }, data: { packageId: input.packageId } });
      }
    }
    const prefix = scope.settings.billing?.invoicePrefix || 'INV';
    const ref = await nextDocNumber(tx, scope.tenantId, 'invoice', prefix, financialYear(issueDate, scope.timezone));
    const invoice = await tx.invoice.create({
      data: {
        tenantId: scope.tenantId,
        ref,
        clientId: client.id,
        caseId: input.caseId,
        status: input.issue ? 'ISSUED' : 'DRAFT',
        currency: 'INR',
        taxMode: input.taxMode,
        issueDate,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        notes: input.notes || null,
        createdBy: scope.actorId,
        items: {
          create: totals.items.map((it, i) => ({
            tenantId: scope.tenantId,
            description: it.description,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            taxRate: it.taxRate,
            amount: it.amount,
            sortOrder: i,
          })),
        },
        installments: { create: installments.map((p) => ({ tenantId: scope.tenantId, ...p })) },
      },
    });
    await logActivity(tx, scope, {
      type: 'INVOICE',
      summary: `Invoice ${ref} · ${formatMoney(totals.total)}${installments.length > 1 ? ` in ${installments.length} installments` : ''}`,
      clientId: client.id,
      caseId: input.caseId,
    });
    return { ...invoice, clientFirstName: client.firstName };
  });
  if (invoice.status === 'ISSUED') await notifyIssued(scope, invoice);
  return invoice;
}

async function notifyIssued(scope: Scope, inv: { clientId: string; caseId: string | null; ref: string; total: number; currency: string; clientFirstName: string }) {
  const { fireAutomation } = await import('./whatsapp/automations');
  await fireAutomation(scope, 'INVOICE_ISSUED', {
    clientId: inv.clientId,
    caseId: inv.caseId,
    vars: [inv.clientFirstName, inv.ref, formatMoney(inv.total, inv.currency)],
  });
}

async function notifyPaid(scope: Scope, p: { clientId: string; amount: number; receiptRef: string }, caseId: string | null, currency: string) {
  const client = await inTenant(scope, (tx) => tx.client.findUnique({ where: { id: p.clientId } }));
  if (!client) return;
  const { fireAutomation } = await import('./whatsapp/automations');
  await fireAutomation(scope, 'PAYMENT_RECEIVED', {
    clientId: p.clientId,
    caseId,
    vars: [client.firstName, formatMoney(p.amount, currency), p.receiptRef],
  });
}

export async function setInvoiceStatus(scope: Scope, invoiceId: string, status: Extract<InvoiceStatus, 'ISSUED' | 'VOID'>) {
  const inv = await setStatusTx(scope, invoiceId, status);
  if (status === 'ISSUED') await notifyIssued(scope, { ...inv, clientFirstName: inv.client.firstName });
}

function setStatusTx(scope: Scope, invoiceId: string, status: Extract<InvoiceStatus, 'ISSUED' | 'VOID'>) {
  return inTenant(scope, async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { client: true } });
    if (!inv) throw new UserError('Invoice not found');
    if (status === 'VOID' && inv.amountPaid > 0) throw new UserError("Invoices with payments can't be voided");
    if (status === 'ISSUED' && inv.status !== 'DRAFT') throw new UserError('Only drafts can be issued');
    await tx.invoice.update({ where: { id: invoiceId }, data: { status } });
    await logActivity(tx, scope, {
      type: 'INVOICE',
      summary: `Invoice ${inv.ref} ${status === 'VOID' ? 'voided' : 'issued'}`,
      clientId: inv.clientId,
      caseId: inv.caseId,
    });
    return inv;
  });
}

// ── Payments ────────────────────────────────────────────────────────────────

export const paymentInput = z.object({
  amount: money('amount'),
  method: z.enum(['UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'RAZORPAY', 'OTHER']),
  reference: z.string().trim().max(120).optional(),
  paidAt: z.string().min(1, 'When was it paid?'),
});

/**
 * Record a payment against an invoice, allocate it to installments in due order,
 * and issue a receipt number. Idempotent for gateway payments via gatewayId.
 */
export async function recordPaymentTx(
  tx: Tx,
  scope: Scope,
  invoiceId: string,
  p: { amount: number; method: PaymentMethod; reference?: string | null; paidAt: Date; gatewayId?: string },
) {
  if (p.gatewayId) {
    const existing = await tx.payment.findUnique({ where: { gatewayId: p.gatewayId } });
    if (existing) return existing;
  }
  const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { installments: true } });
  if (!inv) throw new UserError('Invoice not found');
  if (inv.status === 'VOID' || inv.status === 'DRAFT') throw new UserError('Issue the invoice before recording payments');
  if (p.amount <= 0) throw new UserError('Amount must be more than zero');
  const balance = inv.total - inv.amountPaid;
  if (p.amount > balance) throw new UserError(`That's more than the balance due (${formatMoney(balance, inv.currency)})`);

  const { updates } = allocatePayment(inv.installments, p.amount);
  for (const u of updates) {
    const before = inv.installments.find((i) => i.id === u.id)!;
    if (u.paidAmount !== before.paidAmount) {
      await tx.installment.update({
        where: { id: u.id },
        data: { paidAmount: u.paidAmount, paidAt: u.fullyPaid ? p.paidAt : null },
      });
    }
  }
  const amountPaid = inv.amountPaid + p.amount;
  await tx.invoice.update({
    where: { id: inv.id },
    data: { amountPaid, status: amountPaid >= inv.total ? 'PAID' : 'PARTIALLY_PAID' },
  });
  const receiptRef = await nextDocNumber(tx, scope.tenantId, 'receipt', 'RCPT', financialYear(p.paidAt, scope.timezone));
  const payment = await tx.payment.create({
    data: {
      tenantId: scope.tenantId,
      invoiceId: inv.id,
      clientId: inv.clientId,
      amount: p.amount,
      method: p.method,
      reference: p.reference || null,
      paidAt: p.paidAt,
      receiptRef,
      recordedBy: scope.actorId,
      gatewayId: p.gatewayId ?? null,
    },
  });
  // Referred clients: credit the sub-agent's share of this payment.
  await accrueOnPayment(tx, scope, { id: payment.id, amount: p.amount, clientId: inv.clientId }, inv);
  await logActivity(tx, scope, {
    type: 'PAYMENT',
    summary: `Payment received · ${formatMoney(p.amount, inv.currency)} via ${p.method.replace('_', ' ').toLowerCase()} · ${receiptRef}`,
    clientId: inv.clientId,
    caseId: inv.caseId,
  });
  return payment;
}

export async function recordPayment(scope: Scope, invoiceId: string, raw: unknown) {
  const input = paymentInput.parse(raw);
  const paidAt = parseLocal(input.paidAt, scope.timezone);
  if (!paidAt) throw new UserError('Invalid date');
  if (paidAt.getTime() > Date.now() + 86400_000) throw new UserError("Payment date can't be in the future");
  const payment = await inTenant(scope, (tx) =>
    recordPaymentTx(tx, scope, invoiceId, { amount: input.amount, method: input.method, reference: input.reference, paidAt }),
  );
  await notifyPaymentById(scope, payment.id);
  return payment;
}

/** Fire the PAYMENT_RECEIVED automation for a recorded payment (manual or gateway). */
export async function notifyPaymentById(scope: Scope, paymentId: string) {
  const p = await inTenant(scope, (tx) => tx.payment.findUnique({ where: { id: paymentId }, include: { invoice: true } }));
  if (p) await notifyPaid(scope, p, p.invoice.caseId, p.invoice.currency);
}
