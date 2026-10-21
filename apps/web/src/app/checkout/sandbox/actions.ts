'use server';

import { redirect } from 'next/navigation';
import { platformBilling } from '@/integrations/core/platform';
import type { SandboxBillingBody } from '@/integrations/platform-billing/sandbox';
import { signSandboxBilling } from '@/integrations/platform-billing/sandbox';

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

/** Sandbox checkout: post a signed webhook to our own endpoint, as Razorpay would. */
export async function paySandbox(fields: Record<string, string>) {
  if (!platformBilling().sandbox) throw new Error('Not in sandbox');
  const now = Date.now();
  const paymentId = `pay_sbx_${now.toString(36)}`;
  const amount = Number(fields.amount);
  const body: SandboxBillingBody = fields.topup
    ? { events: [{ type: 'topup.paid', tenantId: fields.tenant!, paymentId, amount, currency: fields.currency!, credits: Number(fields.credits) }] }
    : {
        events: [
          {
            type: 'subscription.charged',
            tenantId: fields.tenant!,
            providerSubscriptionId: fields.sub!,
            periodEnd: new Date(now + (fields.interval === 'month' ? 30 : 365) * 86400_000).toISOString(),
            payment: { id: paymentId, amount, currency: fields.currency! },
          },
        ],
      };
  const raw = JSON.stringify(body);
  const res = await fetch(`${appUrl()}/api/webhooks/platform/billing-sandbox`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sandbox-signature': signSandboxBilling(raw) },
    body: raw,
  });
  if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
  redirect(`/${fields.slug}/settings?tab=plan&paid=1`);
}
