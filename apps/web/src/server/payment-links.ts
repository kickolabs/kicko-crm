import 'server-only';
import type { PaymentMethod } from '@kicko/db';
import { resolve } from '@/integrations/core/connections';
import { ProviderError } from '@/integrations/core/types';
import { meter } from '@/integrations/core/usage';
import type { PaymentEvent, PaymentsAdapter } from '@/integrations/payments/port';
import { fullName } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { notifyPaymentById, recordPaymentTx } from './billing';
import { inTenant, UserError, type Scope } from './scope';
import { requireFeature } from './plan';

// Online payment links on top of the payments port. The gateway (Razorpay,
// sandbox…) is the agency's ProviderConnection for "payments".

export async function payments(scope: Pick<Scope, 'tenantId' | 'slug'>) {
  const r = await resolve<PaymentsAdapter>(scope.tenantId, scope.slug, 'payments');
  return r ? { adapter: r.adapter, provider: r.descriptor.id, name: r.descriptor.name, sandbox: Boolean(r.descriptor.sandbox) } : null;
}

/** How a gateway payment appears in the ledger. */
const ledgerMethod = (provider: string): PaymentMethod => (provider === 'razorpay' ? 'RAZORPAY' : 'OTHER');

/** Create a payment link for the next unpaid installment (or the whole balance). */
export async function createLinkForInvoice(scope: Scope, invoiceId: string, appUrl: string) {
  await requireFeature(scope.tenantId, 'payment_links');
  const p = await payments(scope);
  if (!p) throw new UserError('Connect a payment gateway in Settings → Billing first');

  const inv = await inTenant(scope, (tx) =>
    tx.invoice.findUnique({
      where: { id: invoiceId },
      include: { client: true, installments: { orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }] }, links: true },
    }),
  );
  if (!inv) throw new UserError('Invoice not found');
  if (inv.status === 'PAID' || inv.status === 'VOID' || inv.status === 'DRAFT') throw new UserError('This invoice has nothing to collect');
  const next = inv.installments.find((i) => i.paidAmount < i.amount);
  const amount = next ? next.amount - next.paidAmount : inv.total - inv.amountPaid;
  const open = inv.links.find((l) => l.status === 'created' && l.amount === amount && l.provider.toLowerCase() === p.provider);
  if (open) return open.url;

  let link: { id: string; url: string };
  try {
    link = await p.adapter.createLink({
      amount,
      currency: inv.currency,
      referenceId: `${inv.ref}-${inv.links.length + 1}`.replace(/\//g, '-'),
      description: `${inv.ref}${next && inv.installments.length > 1 ? ` · ${next.label}` : ''} · ${formatMoney(amount, inv.currency)}`,
      customer: { name: fullName(inv.client), contact: inv.client.phoneNormalized, email: inv.client.email },
      notes: { invoice: inv.ref, tenant: scope.tenantId },
      callbackUrl: `${appUrl}/pay/thanks`,
    });
  } catch (err) {
    if (err instanceof ProviderError) throw new UserError(`${p.name}: ${err.message}`);
    throw err;
  }
  await inTenant(scope, (tx) =>
    tx.paymentLink.create({
      data: { tenantId: scope.tenantId, invoiceId: inv.id, provider: p.provider, providerId: link.id, url: link.url, amount },
    }),
  );
  await meter(scope.tenantId, 'payments', p.provider, 'link');
  return link.url;
}

/**
 * Apply verified gateway events. Idempotent on the provider payment id, so
 * webhook retries never double-record.
 */
export async function processPaymentEvents(scope: Scope, provider: string, events: PaymentEvent[]) {
  for (const e of events) {
    const recorded = await inTenant(scope, async (tx) => {
      const link = await tx.paymentLink.findUnique({ where: { providerId: e.linkId } });
      if (!link) return null; // not ours (or deleted)
      if (await tx.payment.findUnique({ where: { gatewayId: e.paymentId } })) return null; // retry
      const payment = await recordPaymentTx(tx, scope, link.invoiceId, {
        amount: e.amount,
        method: ledgerMethod(provider),
        reference: `${e.paymentId}${e.method ? ` · ${e.method}` : ''}`,
        paidAt: e.paidAt,
        gatewayId: e.paymentId,
      });
      await tx.paymentLink.update({ where: { id: link.id }, data: { status: 'paid', paidAt: new Date() } });
      return payment;
    });
    if (recorded) {
      await meter(scope.tenantId, 'payments', provider, 'payment', 1, { amount: e.amount });
      await notifyPaymentById(scope, recorded.id);
    }
  }
}
