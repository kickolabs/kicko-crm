'use server';

import { randomBytes } from 'node:crypto';
import { redirect } from 'next/navigation';
import { withTenant } from '@kicko/db';
import { resolve, webhookUrl } from '@/integrations/core/connections';
import type { PaymentsAdapter } from '@/integrations/payments/port';
import { sandboxSignature, type SandboxPaidBody } from '@/integrations/payments/sandbox';
import { getTenantBySlug } from '@/lib/tenant';

/** Sandbox checkout: post a signed "paid" webhook to our own endpoint, as a gateway would. */
export async function payInSandbox(slug: string, linkId: string) {
  const tenant = await getTenantBySlug(slug);
  if (!tenant) redirect('/pay/thanks?razorpay_payment_link_status=failed');
  const conn = await resolve<PaymentsAdapter>(tenant.id, slug, 'payments');
  if (!conn?.descriptor.sandbox) redirect('/pay/thanks?razorpay_payment_link_status=failed');
  const link = await withTenant(tenant.id, (tx) => tx.paymentLink.findUnique({ where: { providerId: linkId } }));
  if (!link || link.status !== 'created') redirect('/pay/thanks?razorpay_payment_link_status=failed');

  const body: SandboxPaidBody = {
    linkId,
    paymentId: `pay_sbx_${randomBytes(8).toString('hex')}`,
    amount: link.amount,
    method: 'upi',
    paidAt: new Date().toISOString(),
  };
  const raw = JSON.stringify(body);
  const res = await fetch(webhookUrl('payments', conn.descriptor.id, slug), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sandbox-Signature': sandboxSignature(raw, conn.config.webhookSecret!) },
    body: raw,
  });
  redirect(`/pay/thanks?razorpay_payment_link_status=${res.ok ? 'paid' : 'failed'}`);
}
