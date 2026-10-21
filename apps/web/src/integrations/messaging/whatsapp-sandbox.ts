import 'server-only';
import { randomBytes } from 'node:crypto';
import { getObject } from '@/server/storage';
import { metaHandshake, parseMetaWebhook, templatePayload, textPayload, verifySignature, type WaWebhook } from '@/server/whatsapp/meta';
import type { ProviderDescriptor } from '../core/types';
import type { MessagingAdapter } from './port';

// WhatsApp sandbox: same Meta payload formats and signatures, but nothing leaves
// the server. Outbound messages go to an in-memory outbox; inbound ones come from
// the simulator as real, signed Meta-format webhooks.

export const SANDBOX_PHONE_NUMBER_ID = '100000000000001';

export const sandboxOutbox: { at: Date; tenantId: string; to: string; body: Record<string, unknown> }[] = [];

export const whatsappSandbox: ProviderDescriptor<MessagingAdapter> = {
  id: 'whatsapp-sandbox',
  capability: 'messaging',
  name: 'WhatsApp sandbox',
  description: 'Everything works inside Kicko (inbox, templates, automations, ticks) but nothing reaches real phones. Includes a simulator.',
  sandbox: true,
  webhookPath: true,
  connectLabel: 'Try it in sandbox',
  features: { channel: 'WHATSAPP', templates: true, window24h: true, media: true, readReceipts: true, simulator: true },
  fields: [
    { key: 'appSecret', label: 'App secret', secret: true, generated: true },
    { key: 'verifyToken', label: 'Webhook verify token', generated: true },
  ],
  setup: (prev) => ({
    appSecret: prev?.appSecret || randomBytes(24).toString('base64url'),
    verifyToken: prev?.verifyToken || randomBytes(18).toString('base64url'),
  }),
  create(cfg, ctx): MessagingAdapter {
    const send = async (payload: ReturnType<typeof textPayload> | ReturnType<typeof templatePayload>) => {
      sandboxOutbox.push({ at: new Date(), tenantId: ctx.tenantId, to: payload.to, body: payload });
      if (sandboxOutbox.length > 500) sandboxOutbox.shift();
      return { id: `wamid.SANDBOX${randomBytes(12).toString('hex').toUpperCase()}` };
    };
    return {
      channel: 'WHATSAPP',
      sendText: (to, body) => send(textPayload(to, body)),
      sendTemplate: (to, name, language, params) => send(templatePayload(to, name, language, params)),
      async markRead() {},
      async fetchMedia(ref) {
        // Simulator media lives in this agency's sandbox area of storage.
        const key = ref.replace(/^sandbox:/, '');
        if (!key.startsWith(`tenants/${ctx.tenantId}/sandbox/`)) throw new Error('Media not found');
        const ext = key.split('.').pop();
        return { bytes: await getObject(key), mime: ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg' };
      },
      listTemplates: async () => null,
      handshake: (params) => metaHandshake(params, cfg.verifyToken!),
      parseWebhook(raw, headers) {
        if (!verifySignature(raw, headers.get('x-hub-signature-256'), cfg.appSecret!)) return null;
        return parseMetaWebhook(JSON.parse(raw) as WaWebhook, SANDBOX_PHONE_NUMBER_ID);
      },
      async healthCheck() {},
    };
  },
};
