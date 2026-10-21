import 'server-only';
import { nextRef, type Tx } from '@kicko/db';
import { z } from 'zod';
import { formatMoney, parseMoney } from '@/lib/money';
import { normalizeEmail, normalizePhone } from '@/lib/phone';
import { inTenant, logActivity, UserError, type Scope } from './scope';

// Sub-agents: partner agents who refer clients for a commission.
// Commission accrues automatically: a % of every payment the referred client
// makes (ex-tax), or a fixed fee when their referral converts to a client.

export const subAgentInput = z
  .object({
    name: z.string().trim().min(1, 'Enter the contact name').max(120),
    company: z.string().trim().max(160).optional(),
    email: z.string().trim().email('Enter a valid email').max(200),
    phone: z.string().trim().max(30).optional(),
    city: z.string().trim().max(80).optional(),
    commissionType: z.enum(['PERCENT', 'FIXED']),
    commission: z.string().trim().min(1, 'Enter the commission'),
    notes: z.string().trim().max(1000).optional(),
    active: z.enum(['on']).optional(),
  })
  .transform((v, ctx) => {
    const n = v.commissionType === 'PERCENT' ? Math.round(Number(v.commission) * 100) : parseMoney(v.commission);
    if (n == null || !Number.isFinite(n) || n < 0 || (v.commissionType === 'PERCENT' && n > 5000)) {
      ctx.addIssue({ code: 'custom', path: ['commission'], message: v.commissionType === 'PERCENT' ? 'Enter a percentage between 0 and 50' : 'Enter an amount' });
      return z.NEVER;
    }
    return { ...v, commissionValue: n };
  });

export const commissionLabel = (a: { commissionType: string; commissionValue: number }) =>
  a.commissionType === 'PERCENT' ? `${a.commissionValue / 100}% of payments` : `${formatMoney(a.commissionValue)} per client`;

export async function saveSubAgent(scope: Scope, id: string | null, raw: unknown) {
  const input = subAgentInput.parse(raw);
  const email = normalizeEmail(input.email)!;
  const phone = input.phone ? normalizePhone(input.phone, scope.country) : null;
  return inTenant(scope, async (tx) => {
    const clash = await tx.subAgent.findFirst({ where: { email, ...(id ? { NOT: { id } } : {}) } });
    if (clash) throw new UserError(`${clash.name} already uses this email`);
    const data = {
      name: input.name,
      company: input.company || null,
      email,
      phone,
      city: input.city || null,
      commissionType: input.commissionType,
      commissionValue: input.commissionValue,
      notes: input.notes || null,
      active: id ? input.active === 'on' : true,
    };
    if (id) {
      await tx.subAgent.update({ where: { id }, data });
      return id;
    }
    const row = await tx.subAgent.create({ data: { tenantId: scope.tenantId, ref: await nextRef(tx, scope.tenantId, 'subagent', 'SA'), ...data } });
    return row.id;
  });
}

/** Staff: say which sub-agent referred a lead (or clear it). */
export async function setLeadSubAgent(scope: Scope, leadId: string, subAgentId: string | null) {
  return inTenant(scope, async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new UserError('Lead not found');
    const agent = subAgentId ? await tx.subAgent.findUnique({ where: { id: subAgentId } }) : null;
    if (subAgentId && !agent) throw new UserError('Sub-agent not found');
    await tx.lead.update({ where: { id: leadId }, data: { subAgentId } });
    if (lead.clientId) await tx.client.update({ where: { id: lead.clientId }, data: { subAgentId } });
    await logActivity(tx, scope, { type: 'SUB_AGENT', summary: agent ? `Referred by sub-agent ${agent.name} (${agent.ref})` : 'Sub-agent removed', leadId });
  });
}

// ── Accrual (called inside the payment and conversion transactions) ─────────

/** Commission on one payment: the GST part is excluded pro rata (the agency passes tax on, it doesn't earn it). */
export function paymentShare(paid: number, invoice: { subtotal: number; total: number }, basisPoints: number) {
  const basis = invoice.total > 0 ? Math.round((paid * invoice.subtotal) / invoice.total) : paid;
  return { basis, amount: Math.round((basis * basisPoints) / 10_000) };
}

/** A client payment came in: credit the referring sub-agent their share, ex-tax. */
export async function accrueOnPayment(
  tx: Tx,
  scope: Scope,
  payment: { id: string; amount: number; clientId: string },
  invoice: { subtotal: number; total: number; currency: string },
) {
  const client = await tx.client.findUnique({ where: { id: payment.clientId }, include: { subAgent: true } });
  const agent = client?.subAgent;
  if (!agent?.active || agent.commissionType !== 'PERCENT' || !agent.commissionValue) return;
  const { basis, amount } = paymentShare(payment.amount, invoice, agent.commissionValue);
  if (amount <= 0) return;
  await tx.subAgentCommission.create({
    data: { tenantId: scope.tenantId, subAgentId: agent.id, clientId: payment.clientId, paymentId: payment.id, kind: 'PAYMENT_SHARE', basis, amount, currency: invoice.currency },
  });
}

/** A referral became a client: fixed-fee agents earn their fee once per client. */
export async function accrueOnConversion(tx: Tx, scope: Scope, clientId: string, subAgentId: string | null) {
  if (!subAgentId) return;
  const agent = await tx.subAgent.findUnique({ where: { id: subAgentId } });
  if (!agent?.active || agent.commissionType !== 'FIXED' || !agent.commissionValue) return;
  const already = await tx.subAgentCommission.count({ where: { subAgentId, clientId, kind: 'REFERRAL_FEE' } });
  if (already) return;
  await tx.subAgentCommission.create({
    data: { tenantId: scope.tenantId, subAgentId, clientId, kind: 'REFERRAL_FEE', basis: 0, amount: agent.commissionValue, currency: 'INR' },
  });
}

// ── Payouts ─────────────────────────────────────────────────────────────────

export async function markCommissionsPaid(scope: Scope, subAgentId: string, ids: string[], paidRef: string) {
  const ref = paidRef.trim();
  if (!ref) throw new UserError('Enter the payment reference (UTR, cheque no.)');
  if (!ids.length) throw new UserError('Select at least one commission');
  return inTenant(scope, async (tx) => {
    const r = await tx.subAgentCommission.updateMany({ where: { id: { in: ids }, subAgentId, status: 'DUE' }, data: { status: 'PAID', paidAt: new Date(), paidRef: ref.slice(0, 120) } });
    if (!r.count) throw new UserError('Nothing to mark as paid');
    const rows = await tx.subAgentCommission.findMany({ where: { id: { in: ids } } });
    const agent = await tx.subAgent.findUnique({ where: { id: subAgentId } });
    const total = rows.reduce((s, c) => s + c.amount, 0);
    for (const clientId of new Set(rows.map((c) => c.clientId))) {
      await logActivity(tx, scope, { type: 'SUB_AGENT', summary: `Commission paid to ${agent?.name ?? 'sub-agent'}: ${formatMoney(total)} (${ref})`, clientId });
    }
    return r.count;
  });
}

export async function voidCommission(scope: Scope, id: string) {
  const r = await inTenant(scope, (tx) => tx.subAgentCommission.updateMany({ where: { id, status: 'DUE' }, data: { status: 'VOID' } }));
  if (!r.count) throw new UserError('Only commissions that are still due can be voided');
}

// ── Referral (from the partner portal) ──────────────────────────────────────

export const referralInput = z.object({
  firstName: z.string().trim().min(1, 'Enter the first name').max(80),
  lastName: z.string().trim().max(80).optional(),
  phone: z.string().trim().min(6, 'Enter a phone number').max(30),
  email: z.string().trim().email('Enter a valid email').max(200).optional().or(z.literal('')),
  interestCountry: z.string().max(4).optional(),
  interestCategory: z.enum(['STUDY', 'PR', 'WORK', 'VISIT', 'FAMILY']).optional().or(z.literal('')),
  message: z.string().trim().max(1000).optional(),
  consent: z.literal('on', { error: 'Confirm the client agreed to be contacted' }),
});

export type ReferralResult = { status: 'created'; ref: string } | { status: 'exists' };

export function describeAgent(a: { name: string; company: string | null }) {
  return a.company ? `${a.name} (${a.company})` : a.name;
}
