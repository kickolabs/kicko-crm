import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ProviderDescriptor } from '../core/types';
import type { PaymentEvent, PaymentsAdapter } from './port';

// Sandbox payments: links open a Kicko page where you "pay" with one click.
// That page posts a signed webhook to the real endpoint, exercising the full path.

export const sandboxSignature = (raw: string, secret: string) => createHmac('sha256', secret).update(raw).digest('hex');

export type SandboxPaidBody = { linkId: string; paymentId: string; amount: number; method: string; paidAt: string };

export const paymentsSandbox: ProviderDescriptor<PaymentsAdapter> = {
  id: 'payments-sandbox',
  capability: 'payments',
  name: 'Sandbox payments',
  description: 'Test payment links without a gateway account. Nothing is charged.',
  sandbox: true,
  webhookPath: true,
  connectLabel: 'Use sandbox payments',
  features: { currencies: ['INR'], partialPayments: false, notifiesCustomer: false },
  fields: [{ key: 'webhookSecret', label: 'Webhook secret', secret: true, generated: true }],
  setup: (prev) => ({ webhookSecret: prev?.webhookSecret || randomBytes(24).toString('base64url') }),
  create(cfg, ctx): PaymentsAdapter {
    return {
      async createLink(i) {
        const id = `plink_sbx_${randomBytes(8).toString('hex')}`;
        const q = new URLSearchParams({ amount: String(i.amount), currency: i.currency, desc: i.description });
        return { id, url: `${ctx.appUrl}/pay/sandbox/${ctx.slug}/${id}?${q}` };
      },
      parseWebhook(raw, headers) {
        const given = Buffer.from(headers.get('x-sandbox-signature') ?? '');
        const expected = Buffer.from(sandboxSignature(raw, cfg.webhookSecret!));
        if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
        const b = JSON.parse(raw) as SandboxPaidBody;
        const ev: PaymentEvent = { type: 'payment.succeeded', linkId: b.linkId, paymentId: b.paymentId, amount: b.amount, method: b.method, paidAt: new Date(b.paidAt) };
        return [ev];
      },
      async healthCheck() {},
    };
  },
};
