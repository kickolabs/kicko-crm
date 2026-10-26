import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ProviderError, type ProviderDescriptor } from '../core/types';
import { mapAnswers, type AdLead, type LeadAdsAdapter } from './port';

// Meta (Facebook & Instagram) lead ads via the Webhooks "leadgen" field and the Graph API.
// Meta posts only the lead id; we fetch the answers with the Page access token.
// Docs: https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving

const GRAPH = 'https://graph.facebook.com/v21.0';

type Change = { field: string; value: { leadgen_id: string; form_id?: string; ad_id?: string; page_id?: string } };

export const metaLeadAds: ProviderDescriptor<LeadAdsAdapter> = {
  id: 'meta-lead-ads',
  capability: 'lead_ads',
  name: 'Facebook & Instagram lead ads',
  description: 'New lead-form submissions arrive as leads with the campaign, form and ad.',
  webhookPath: true,
  docsUrl: 'https://developers.facebook.com/docs/marketing-api/guides/lead-ads/',
  features: {},
  fields: [
    { key: 'pageAccessToken', label: 'Page access token', secret: true, required: true, hint: 'A long-lived token with leads_retrieval and pages_manage_metadata' },
    { key: 'appSecret', label: 'App secret', secret: true, required: true, hint: 'Used to check that webhooks really come from Meta' },
    { key: 'verifyToken', label: 'Verify token', generated: true, hint: 'Paste this in the Webhooks setup in your Meta app' },
  ],
  setup: (prev) => ({ verifyToken: prev?.verifyToken || randomBytes(18).toString('base64url') }),
  guide: [
    'In your Meta app, add the Webhooks product, choose Page, and subscribe to the "leadgen" field.',
    'Use the webhook URL and verify token shown here.',
    'Subscribe your Page to the app, and give the token the leads_retrieval permission.',
  ],
  create(cfg): LeadAdsAdapter {
    const fetchLead = async (id: string): Promise<{ field_data: { name: string; values: string[] }[]; campaign_name?: string; form_id?: string; ad_name?: string }> => {
      const res = await fetch(`${GRAPH}/${encodeURIComponent(id)}?fields=field_data,campaign_name,ad_name,form_id&access_token=${encodeURIComponent(cfg.pageAccessToken!)}`);
      if (!res.ok) throw new ProviderError(`Meta lead ${id}: HTTP ${res.status}`, 'meta-lead-ads');
      return res.json();
    };
    return {
      async parseWebhook({ method, url, raw, headers }) {
        if (method === 'GET') {
          const ok = url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === cfg.verifyToken;
          return ok ? { kind: 'challenge', body: url.searchParams.get('hub.challenge') ?? '' } : null;
        }
        const sig = (headers.get('x-hub-signature-256') ?? '').replace(/^sha256=/, '');
        const expected = createHmac('sha256', cfg.appSecret!).update(raw).digest('hex');
        if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
        const body = JSON.parse(raw) as { object?: string; entry?: { changes?: Change[] }[] };
        if (body.object !== 'page') return { kind: 'leads', leads: [] };
        const leads: AdLead[] = [];
        for (const ch of (body.entry ?? []).flatMap((e) => e.changes ?? []).filter((c) => c.field === 'leadgen')) {
          const lead = await fetchLead(ch.value.leadgen_id);
          const answers = Object.fromEntries(lead.field_data.map((f) => [f.name, f.values.join(', ')]));
          leads.push({ externalId: ch.value.leadgen_id, answers, fields: mapAnswers(answers), campaign: lead.campaign_name ?? null, form: lead.form_id ?? ch.value.form_id ?? null, ad: lead.ad_name ?? ch.value.ad_id ?? null });
        }
        return { kind: 'leads', leads };
      },
      async healthCheck() {
        const res = await fetch(`${GRAPH}/me?access_token=${encodeURIComponent(cfg.pageAccessToken!)}`);
        if (!res.ok) throw new ProviderError('Meta did not accept the page access token', 'meta-lead-ads');
      },
    };
  },
};
