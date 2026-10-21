import 'server-only';
import { metaHandshake, parseMetaWebhook, templatePayload, textPayload, verifySignature, type WaWebhook } from '@/server/whatsapp/meta';
import { ProviderError, type ProviderDescriptor } from '../core/types';
import type { MessagingAdapter, RemoteTemplate } from './port';
import { randomBytes } from 'node:crypto';

// Meta WhatsApp Cloud API (graph.facebook.com), each agency's own number.

const GRAPH = 'https://graph.facebook.com';
const version = () => process.env.META_GRAPH_VERSION ?? 'v23.0';

export const whatsappCloud: ProviderDescriptor<MessagingAdapter> = {
  id: 'whatsapp-cloud',
  capability: 'messaging',
  name: 'WhatsApp Cloud API (Meta)',
  description: 'Your own WhatsApp Business number through Meta. Templates are approved in Meta Business Manager.',
  docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
  webhookPath: true,
  connectLabel: 'Go live',
  guide: [
    'In Meta for Developers, create a Business app and add the WhatsApp product.',
    'Add your business phone number; copy its Phone number ID and WhatsApp Business Account ID.',
    'In Business Settings, create a System User and generate a permanent token with whatsapp_business_messaging and whatsapp_business_management.',
    'Copy the App secret (App settings → Basic).',
    'After saving, set the callback URL and verify token shown here in WhatsApp → Configuration and subscribe to "messages".',
  ],
  features: { channel: 'WHATSAPP', templates: true, window24h: true, media: true, readReceipts: true },
  fields: [
    { key: 'phoneNumberId', label: 'Phone number ID', required: true, pattern: '^\\d{6,20}$', hint: 'Meta → WhatsApp → API setup' },
    { key: 'wabaId', label: 'WhatsApp Business Account ID', required: true, pattern: '^\\d{6,20}$' },
    { key: 'displayNumber', label: 'Display number', required: true, placeholder: '+91 98765 43210' },
    { key: 'accessToken', label: 'Permanent access token', secret: true, required: true, hint: 'System User token with whatsapp_business_messaging + whatsapp_business_management' },
    { key: 'appSecret', label: 'App secret', secret: true, required: true, hint: 'App settings → Basic. Used to verify webhooks.' },
    { key: 'verifyToken', label: 'Webhook verify token', generated: true },
  ],
  setup: (prev) => ({ verifyToken: prev?.verifyToken || randomBytes(18).toString('base64url') }),
  create(cfg): MessagingAdapter {
    const graph = async <T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> => {
      const res = await fetch(`${GRAPH}/${version()}/${path}`, {
        method: init.method ?? 'GET',
        headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
      const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
      if (!res.ok || json.error) throw new ProviderError(json.error?.message ?? `WhatsApp API error ${res.status}`, 'whatsapp-cloud');
      return json;
    };
    const send = async (payload: unknown) => {
      const r = await graph<{ messages: { id: string }[] }>(`${cfg.phoneNumberId}/messages`, { method: 'POST', body: payload });
      return { id: r.messages[0]!.id };
    };
    return {
      channel: 'WHATSAPP',
      sendText: (to, body) => send(textPayload(to, body)),
      sendTemplate: (to, name, language, params) => send(templatePayload(to, name, language, params)),
      async markRead(id) {
        await graph(`${cfg.phoneNumberId}/messages`, { method: 'POST', body: { messaging_product: 'whatsapp', status: 'read', message_id: id } }).catch(() => undefined);
      },
      async fetchMedia(ref) {
        const meta = await graph<{ url: string; mime_type: string }>(ref);
        const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${cfg.accessToken}` }, signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new ProviderError(`Media download failed (${res.status})`, 'whatsapp-cloud');
        return { bytes: Buffer.from(await res.arrayBuffer()), mime: meta.mime_type };
      },
      async listTemplates() {
        const r = await graph<{ data: { name: string; language: string; status: string; category: string; components: { type: string; text?: string }[] }[] }>(
          `${cfg.wabaId}/message_templates?fields=name,language,status,category,components&limit=200`,
        );
        return r.data.map((t): RemoteTemplate => ({ name: t.name, language: t.language, status: t.status, category: t.category, body: t.components.find((c) => c.type === 'BODY')?.text ?? '' }));
      },
      handshake: (params) => metaHandshake(params, cfg.verifyToken!),
      parseWebhook(raw, headers) {
        if (!verifySignature(raw, headers.get('x-hub-signature-256'), cfg.appSecret!)) return null;
        return parseMetaWebhook(JSON.parse(raw) as WaWebhook, cfg.phoneNumberId!);
      },
      async healthCheck() {
        await graph(`${cfg.phoneNumberId}?fields=display_phone_number,verified_name`);
      },
    };
  },
};
