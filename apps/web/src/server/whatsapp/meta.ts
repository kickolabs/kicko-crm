import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MessagingEvent } from '@/integrations/messaging/port';

// Meta WhatsApp Cloud API formats: request payloads, webhook signature and
// webhook parsing. Pure functions shared by the live and sandbox adapters.

/** Meta wants the recipient as digits with country code, no "+". */
export const toWaId = (phone: string) => phone.replace(/\D/g, '');

export function textPayload(to: string, body: string) {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to: toWaId(to), type: 'text', text: { preview_url: true, body } };
}

export function templatePayload(to: string, name: string, language: string, params: string[]) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toWaId(to),
    type: 'template',
    template: {
      name,
      language: { code: language },
      ...(params.length ? { components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] } : {}),
    },
  };
}

/** X-Hub-Signature-256: "sha256=" + hex(HMAC-SHA256(rawBody, appSecret)). */
export function verifySignature(rawBody: string, header: string | null, appSecret: string) {
  if (!header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', appSecret).update(rawBody).digest('hex'));
  const given = Buffer.from(header.slice(7));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function sign(rawBody: string, appSecret: string) {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

/** GET handshake: echo hub.challenge when the verify token matches. */
export function metaHandshake(params: URLSearchParams, verifyToken: string) {
  return params.get('hub.mode') === 'subscribe' && params.get('hub.verify_token') === verifyToken ? (params.get('hub.challenge') ?? '') : null;
}

type Media = { id: string; mime_type?: string; caption?: string; filename?: string };

export type WaInbound = {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: Media;
  document?: Media;
  audio?: Media;
  video?: Media;
  sticker?: Media;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  button?: { text: string; payload?: string };
  interactive?: { type: string; button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } };
  context?: { id: string };
};

export type WaStatus = {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  errors?: { code: number; title: string; message?: string }[];
};

export type WaWebhook = {
  object: 'whatsapp_business_account';
  entry: {
    id: string;
    changes: {
      field: string;
      value: {
        messaging_product: 'whatsapp';
        metadata: { display_phone_number: string; phone_number_id: string };
        contacts?: { profile?: { name?: string }; wa_id: string }[];
        messages?: WaInbound[];
        statuses?: WaStatus[];
      };
    }[];
  }[];
};

/** Plain-text summary of any inbound message type, for the inbox and previews. */
export function inboundText(m: WaInbound): { body: string; media?: { kind: string; id: string; mime?: string; name?: string } } {
  switch (m.type) {
    case 'text':
      return { body: m.text?.body ?? '' };
    case 'image':
    case 'document':
    case 'audio':
    case 'video':
    case 'sticker': {
      const media = m[m.type as 'image']!;
      const label = { image: 'Photo', document: 'Document', audio: 'Voice note', video: 'Video', sticker: 'Sticker' }[m.type];
      return {
        body: media.caption || (m.type === 'document' && media.filename ? `${label}: ${media.filename}` : label!),
        media: { kind: m.type, id: media.id, mime: media.mime_type, name: media.filename },
      };
    }
    case 'location':
      return { body: `Location: ${m.location?.name ?? ''} ${m.location?.address ?? ''} (${m.location?.latitude}, ${m.location?.longitude})`.trim() };
    case 'button':
      return { body: m.button?.text ?? 'Button' };
    case 'interactive':
      return { body: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? 'Reply' };
    default:
      return { body: `[${m.type} message]` };
  }
}

/** Translate a Meta webhook into normalised events for one phone number. */
export function parseMetaWebhook(payload: WaWebhook, phoneNumberId: string): MessagingEvent[] {
  if (payload.object !== 'whatsapp_business_account') return [];
  const events: MessagingEvent[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      if (change.field !== 'messages' || v?.metadata?.phone_number_id !== phoneNumberId) continue;
      for (const m of v.messages ?? []) {
        const { body, media } = inboundText(m);
        events.push({
          type: 'message.received',
          id: m.id,
          from: m.from,
          profileName: v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name,
          body,
          media: media ? { kind: media.kind, ref: media.id, mime: media.mime, name: media.name } : undefined,
          at: new Date(Number(m.timestamp) * 1000 || Date.now()),
        });
      }
      for (const s of v.statuses ?? []) {
        events.push({
          type: 'message.status',
          id: s.id,
          status: s.status,
          at: new Date(Number(s.timestamp) * 1000 || Date.now()),
          error: s.errors?.map((e) => e.message ?? e.title).join('; '),
        });
      }
    }
  }
  return events;
}
