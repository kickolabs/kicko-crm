import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PROVIDERS, TENANT_CAPABILITIES, descriptorFor, providersFor } from './core/registry';
import type { MessagingAdapter } from './messaging/port';
import { SANDBOX_PHONE_NUMBER_ID, sandboxOutbox, whatsappSandbox } from './messaging/whatsapp-sandbox';
import type { PaymentsAdapter } from './payments/port';
import { razorpay } from './payments/razorpay';
import { paymentsSandbox, sandboxSignature } from './payments/sandbox';
import { sign } from '@/server/whatsapp/meta';

const ctx = { tenantId: 't1', slug: 'acme', appUrl: 'https://app.test' };
const headers = (h: Record<string, string>) => new Headers(h);

describe('provider registry', () => {
  it('provider ids are unique per capability', () => {
    const keys = PROVIDERS.map((p) => `${p.capability}/${p.id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('every connectable capability with providers has a sandbox', () => {
    for (const cap of TENANT_CAPABILITIES) {
      const list = providersFor(cap);
      if (list.length) expect(list.some((p) => p.sandbox), cap).toBe(true);
    }
  });
  it('field keys are unique and generated fields come from setup()', () => {
    for (const p of PROVIDERS) {
      const keys = p.fields.map((f) => f.key);
      expect(new Set(keys).size, p.id).toBe(keys.length);
      const generated = p.fields.filter((f) => f.generated).map((f) => f.key);
      if (generated.length) expect(Object.keys(p.setup?.(null) ?? {}).sort(), p.id).toEqual(generated.sort());
    }
  });
  it('setup() keeps generated values on reconnect', () => {
    const first = whatsappSandbox.setup!(null);
    expect(whatsappSandbox.setup!(first)).toEqual(first);
  });
  it('looks up descriptors by capability and id', () => {
    expect(descriptorFor('payments', 'razorpay')).toBe(razorpay);
    expect(descriptorFor('messaging', 'razorpay')).toBeUndefined();
  });
});

describe('payments sandbox adapter', () => {
  const cfg = paymentsSandbox.setup!(null);
  const a = paymentsSandbox.create(cfg, ctx) as PaymentsAdapter;
  it('creates links to the in-app checkout', async () => {
    const link = await a.createLink({ amount: 150000, currency: 'INR', referenceId: 'INV-1', description: 'x', customer: { name: 'P' }, notes: {} });
    expect(link.id).toMatch(/^plink_sbx_/);
    expect(link.url).toContain(`https://app.test/pay/sandbox/acme/${link.id}`);
  });
  it('accepts only correctly signed webhooks', () => {
    const raw = JSON.stringify({ linkId: 'plink_sbx_1', paymentId: 'pay_1', amount: 500, method: 'upi', paidAt: '2026-10-21T10:00:00Z' });
    const ev = a.parseWebhook(raw, headers({ 'x-sandbox-signature': sandboxSignature(raw, cfg.webhookSecret!) }));
    expect(ev).toEqual([{ type: 'payment.succeeded', linkId: 'plink_sbx_1', paymentId: 'pay_1', amount: 500, method: 'upi', paidAt: new Date('2026-10-21T10:00:00Z') }]);
    expect(a.parseWebhook(raw, headers({ 'x-sandbox-signature': sandboxSignature(raw, 'other') }))).toBeNull();
    expect(a.parseWebhook(raw, headers({}))).toBeNull();
  });
});

describe('razorpay adapter', () => {
  const a = razorpay.create({ keyId: 'rzp_test_x', keySecret: 's', webhookSecret: 'whsec' }, ctx) as PaymentsAdapter;
  const raw = JSON.stringify({
    event: 'payment_link.paid',
    payload: { payment_link: { entity: { id: 'plink_1' } }, payment: { entity: { id: 'pay_9', amount: 1000, method: 'upi', created_at: 1_790_000_000 } } },
  });
  const sig = createHmac('sha256', 'whsec').update(raw).digest('hex');
  it('normalises payment_link.paid', () => {
    expect(a.parseWebhook(raw, headers({ 'x-razorpay-signature': sig }))).toEqual([
      { type: 'payment.succeeded', linkId: 'plink_1', paymentId: 'pay_9', amount: 1000, method: 'upi', paidAt: new Date(1_790_000_000_000) },
    ]);
  });
  it('rejects forged signatures and ignores other events', () => {
    expect(a.parseWebhook(raw, headers({ 'x-razorpay-signature': 'forged' }))).toBeNull();
    const other = JSON.stringify({ event: 'payment.captured' });
    expect(a.parseWebhook(other, headers({ 'x-razorpay-signature': createHmac('sha256', 'whsec').update(other).digest('hex') }))).toEqual([]);
  });
  it('without a webhook secret nothing is accepted', () => {
    const noSecret = razorpay.create({ keyId: 'rzp_test_x', keySecret: 's' }, ctx) as PaymentsAdapter;
    expect(noSecret.parseWebhook(raw, headers({ 'x-razorpay-signature': sig }))).toBeNull();
  });
});

describe('whatsapp sandbox adapter', () => {
  const cfg = whatsappSandbox.setup!(null);
  const a = whatsappSandbox.create(cfg, ctx) as MessagingAdapter;
  it('records outbound messages per agency instead of sending', async () => {
    const { id } = await a.sendText('919876543210', 'Hello');
    expect(id).toMatch(/^wamid\.SANDBOX/);
    expect(sandboxOutbox.at(-1)).toMatchObject({ tenantId: 't1', to: '919876543210' });
  });
  it('answers the subscription handshake only with the verify token', () => {
    expect(a.handshake(new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': cfg.verifyToken!, 'hub.challenge': '42' }))).toBe('42');
    expect(a.handshake(new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '42' }))).toBeNull();
  });
  it('parses signed Meta-format webhooks into events', () => {
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: '1', changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '910000000000', phone_number_id: SANDBOX_PHONE_NUMBER_ID },
        contacts: [{ profile: { name: 'Ravi' }, wa_id: '919876543210' }],
        messages: [{ from: '919876543210', id: 'wamid.X', timestamp: '1790000000', type: 'text', text: { body: 'hi' } }],
      } }] }],
    });
    const ev = a.parseWebhook(raw, headers({ 'x-hub-signature-256': sign(raw, cfg.appSecret!) }));
    expect(ev).toMatchObject([{ type: 'message.received', id: 'wamid.X', from: '919876543210', profileName: 'Ravi', body: 'hi' }]);
    expect(a.parseWebhook(raw, headers({ 'x-hub-signature-256': sign(raw, 'wrong') }))).toBeNull();
  });
  it('only serves media from its own agency sandbox area', async () => {
    await expect(a.fetchMedia('sandbox:tenants/other/sandbox/x.pdf')).rejects.toThrow();
  });
});
