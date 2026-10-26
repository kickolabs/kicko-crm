import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ProviderDescriptor } from '../core/types';
import { mapAnswers, type LeadAdsAdapter } from './port';

// Sandbox lead ads: post a signed JSON body ({ id, answers, campaign?, form?, ad? }) to the
// webhook to simulate a Facebook lead form submission end to end.

export const leadAdsSignature = (raw: string, secret: string) => createHmac('sha256', secret).update(raw).digest('hex');

export const leadAdsSandbox: ProviderDescriptor<LeadAdsAdapter> = {
  id: 'lead-ads-sandbox',
  capability: 'lead_ads',
  name: 'Sandbox lead ads',
  description: 'Try lead-ad capture without a Meta account: signed test submissions become leads.',
  sandbox: true,
  webhookPath: true,
  connectLabel: 'Use sandbox lead ads',
  features: {},
  fields: [{ key: 'webhookSecret', label: 'Webhook secret', secret: true, generated: true }],
  setup: (prev) => ({ webhookSecret: prev?.webhookSecret || randomBytes(24).toString('base64url') }),
  create(cfg): LeadAdsAdapter {
    return {
      async parseWebhook({ raw, headers }) {
        const given = Buffer.from(headers.get('x-sandbox-signature') ?? '');
        const expected = Buffer.from(leadAdsSignature(raw, cfg.webhookSecret!));
        if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
        const b = JSON.parse(raw) as { id: string; answers: Record<string, string>; campaign?: string; form?: string; ad?: string };
        return { kind: 'leads', leads: [{ externalId: b.id, answers: b.answers, fields: mapAnswers(b.answers), campaign: b.campaign, form: b.form, ad: b.ad }] };
      },
      async healthCheck() {},
    };
  },
};
