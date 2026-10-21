import 'server-only';
import { randomBytes } from 'node:crypto';
import { after } from 'next/server';
import type { Prisma, Tx } from '@kicko/db';
import { z } from 'zod';
import { resolve, saveConnection } from '@/integrations/core/connections';
import { ProviderError } from '@/integrations/core/types';
import { meter } from '@/integrations/core/usage';
import type { InboundMessage, MessagingAdapter, MessagingEvent, StatusUpdate } from '@/integrations/messaging/port';
import { SANDBOX_PHONE_NUMBER_ID } from '@/integrations/messaging/whatsapp-sandbox';
import { fullName } from '@/lib/format';
import { findOrCreateByPhone, type Contact } from '../contacts';
import { inTenant, logActivity, UserError, type Scope } from '../scope';
import { ALLOWED_TYPES, newKey, putObject } from '../storage';
import { sign, type WaWebhook } from './meta';

// WhatsApp features (inbox, 24-hour window, templates, opt-in) on top of the
// messaging port. Which provider delivers (Cloud API, sandbox…) is the agency's
// ProviderConnection; nothing here knows vendor details.

const WINDOW_MS = 24 * 3600_000;

// ── Connection ──────────────────────────────────────────────────────────────

export type Messaging = { adapter: MessagingAdapter; provider: string; sandbox: boolean; config: Record<string, string> };

export async function messaging(scope: Pick<Scope, 'tenantId' | 'slug'>): Promise<Messaging | null> {
  const r = await resolve<MessagingAdapter>(scope.tenantId, scope.slug, 'messaging');
  return r ? { adapter: r.adapter, provider: r.descriptor.id, sandbox: Boolean(r.descriptor.sandbox), config: r.config } : null;
}

/** Connect (or reconnect) a messaging provider; sandbox also seeds approved templates. */
export async function connectMessaging(scope: Scope, provider: string, input: Record<string, string>) {
  await saveConnection(scope.tenantId, scope.actorId, 'messaging', provider, input);
  if (provider === 'whatsapp-sandbox') await seedSandboxTemplates(scope);
}

// ── Templates ───────────────────────────────────────────────────────────────

export const countVars = (body: string) => new Set(body.match(/\{\{\d+\}\}/g) ?? []).size;

/** Templates to create in Meta Business Manager. Seeded as "approved" in sandbox. */
export const SANDBOX_TEMPLATES = [
  { name: 'case_update', category: 'UTILITY', body: 'Hi {{1}}, your {{3}} application has moved to: {{2}}. You can follow every step in your client portal.' },
  { name: 'document_rejected', category: 'UTILITY', body: 'Hi {{1}}, we need a new copy of your {{2}}. Reason: {{3}}. Please upload it in your client portal.' },
  { name: 'invoice_issued', category: 'UTILITY', body: 'Hi {{1}}, invoice {{2}} for {{3}} has been issued. You can view and pay it in your client portal.' },
  { name: 'payment_reminder', category: 'UTILITY', body: 'Hi {{1}}, a payment of {{2}} was due on {{3}}. Please pay at the earliest, or reply here if you need help.' },
  { name: 'payment_received', category: 'UTILITY', body: 'Hi {{1}}, we have received your payment of {{2}}. Receipt number: {{3}}. Thank you!' },
  { name: 'portal_link', category: 'UTILITY', body: 'Hi {{1}}, here is your secure link to your client portal: {{2}} It works once and expires soon.' },
  { name: 'enquiry_follow_up', category: 'MARKETING', body: 'Hi {{1}}, thanks for your interest in studying or settling abroad. When is a good time for our counsellor to call you?' },
];

async function seedSandboxTemplates(scope: Scope) {
  await inTenant(scope, async (tx) => {
    for (const t of SANDBOX_TEMPLATES) {
      await tx.whatsAppTemplate.upsert({
        where: { tenantId_name_language: { tenantId: scope.tenantId, name: t.name, language: 'en' } },
        create: { tenantId: scope.tenantId, ...t, language: 'en', status: 'APPROVED', variables: countVars(t.body) },
        update: { body: t.body, category: t.category, status: 'APPROVED', variables: countVars(t.body), syncedAt: new Date() },
      });
    }
  });
}

export async function syncTemplates(scope: Scope) {
  const m = await messaging(scope);
  if (!m) throw new UserError('Connect WhatsApp first');
  const remote = await m.adapter.listTemplates().catch((e: unknown) => {
    throw new UserError(e instanceof Error ? `Provider: ${e.message}` : 'Could not reach the provider');
  });
  if (remote === null) {
    await seedSandboxTemplates(scope);
    return SANDBOX_TEMPLATES.length;
  }
  await inTenant(scope, async (tx) => {
    for (const t of remote) {
      await tx.whatsAppTemplate.upsert({
        where: { tenantId_name_language: { tenantId: scope.tenantId, name: t.name, language: t.language } },
        create: { tenantId: scope.tenantId, name: t.name, language: t.language, category: t.category, status: t.status, body: t.body, variables: countVars(t.body) },
        update: { category: t.category, status: t.status, body: t.body, variables: countVars(t.body), syncedAt: new Date() },
      });
    }
  });
  return remote.length;
}

export const renderTemplate = (body: string, params: string[]) => body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? `{{${n}}}`);

// ── Contacts & the 24-hour window ───────────────────────────────────────────

export type { Contact };

async function loadContact(tx: Tx, c: Contact) {
  const row = c.kind === 'client' ? await tx.client.findUnique({ where: { id: c.id } }) : await tx.lead.findUnique({ where: { id: c.id } });
  if (!row) throw new UserError('Contact not found');
  return row;
}

export function windowOpen(lastInbound: Date | null | undefined, now = Date.now()) {
  return Boolean(lastInbound && now - lastInbound.getTime() < WINDOW_MS);
}

export function windowClosesAt(lastInbound: Date | null | undefined) {
  return lastInbound ? new Date(lastInbound.getTime() + WINDOW_MS) : null;
}

// ── Sending ─────────────────────────────────────────────────────────────────

const link = (c: Contact) => (c.kind === 'client' ? { clientId: c.id } : { leadId: c.id });

async function deliver(
  scope: Scope,
  contact: Contact,
  phone: string,
  body: string,
  send: (a: MessagingAdapter) => Promise<{ id: string }>,
  extra: { templateName?: string; authorId?: string | null; caseId?: string | null; ai?: Prisma.InputJsonObject },
) {
  const m = await messaging(scope);
  if (!m) throw new UserError('WhatsApp is not connected');
  const msg = await inTenant(scope, (tx) =>
    tx.message.create({
      data: {
        tenantId: scope.tenantId,
        ...link(contact),
        caseId: extra.caseId ?? null,
        channel: 'WHATSAPP',
        direction: 'OUTBOUND',
        body,
        authorId: extra.authorId === undefined ? scope.actorId : extra.authorId,
        status: 'QUEUED',
        phone,
        templateName: extra.templateName ?? null,
        aiGenerated: Boolean(extra.ai),
        aiMeta: extra.ai,
      },
    }),
  );
  try {
    const { id } = await send(m.adapter);
    await inTenant(scope, (tx) => tx.message.update({ where: { id: msg.id }, data: { externalId: id, status: 'SENT' } }));
    await meter(scope.tenantId, 'messaging', m.provider, 'message', 1, { template: extra.templateName ?? null });
  } catch (err) {
    const error = err instanceof ProviderError ? err.message : 'Could not reach WhatsApp';
    await inTenant(scope, (tx) => tx.message.update({ where: { id: msg.id }, data: { status: 'FAILED', error } }));
    throw new UserError(`WhatsApp: ${error}`);
  }
  return msg.id;
}

/** Free-form reply, only inside the 24-hour customer-service window. */
export async function sendText(scope: Scope, contact: Contact, rawBody: string, opts: { ai?: Prisma.InputJsonObject } = {}) {
  const body = z.string().trim().min(1, 'Write a message').max(4096).parse(rawBody);
  const row = await inTenant(scope, (tx) => loadContact(tx, contact));
  if (!row.phoneNormalized) throw new UserError('This contact has no phone number');
  if (!windowOpen(row.waLastInbound)) {
    throw new UserError('The 24-hour window is closed. WhatsApp only allows an approved template until they reply.');
  }
  const to = row.phoneNormalized;
  return deliver(scope, contact, to, body, (a) => a.sendText(to, body), opts.ai ? { ai: opts.ai, authorId: null } : {});
}

/** Approved template: allowed any time, if the contact opted in. */
export async function sendTemplate(
  scope: Scope,
  contact: Contact,
  name: string,
  params: string[],
  opts: { language?: string; authorId?: string | null; caseId?: string | null; skipOptInCheck?: boolean } = {},
) {
  const { row, tpl } = await inTenant(scope, async (tx) => ({
    row: await loadContact(tx, contact),
    tpl: await tx.whatsAppTemplate.findFirst({ where: { name, ...(opts.language ? { language: opts.language } : {}), status: 'APPROVED' } }),
  }));
  if (!tpl) throw new UserError(`Template "${name}" is not approved yet`);
  if (!row.phoneNormalized) throw new UserError('This contact has no phone number');
  if (!opts.skipOptInCheck && !row.waOptIn && !windowOpen(row.waLastInbound)) {
    throw new UserError("This contact hasn't opted in to WhatsApp messages");
  }
  const values = params.slice(0, tpl.variables);
  if (values.length < tpl.variables || values.some((v) => !v.trim())) throw new UserError(`Fill all ${tpl.variables} template fields`);
  const to = row.phoneNormalized;
  return deliver(scope, contact, to, renderTemplate(tpl.body, values), (a) => a.sendTemplate(to, tpl.name, tpl.language, values), {
    templateName: tpl.name,
    authorId: opts.authorId,
    caseId: opts.caseId,
  });
}

export async function setOptIn(scope: Scope, contact: Contact, optIn: boolean) {
  return inTenant(scope, async (tx) => {
    const data = { waOptIn: optIn, waOptInAt: optIn ? new Date() : null };
    if (contact.kind === 'client') await tx.client.update({ where: { id: contact.id }, data });
    else await tx.lead.update({ where: { id: contact.id }, data });
    await logActivity(tx, scope, { type: 'WHATSAPP', summary: optIn ? 'WhatsApp opt-in recorded' : 'WhatsApp opt-out recorded', ...link(contact) });
  });
}

// ── Inbound events (from any messaging provider) ────────────────────────────

const STATUS_RANK = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 } as const;

async function storeInboundMedia(scope: Scope, m: Messaging, media: NonNullable<InboundMessage['media']>) {
  try {
    const { bytes, mime } = await m.adapter.fetchMedia(media.ref);
    const clean = (media.mime ?? mime).split(';')[0]!.trim();
    const key = newKey(scope.tenantId, 'whatsapp', clean in ALLOWED_TYPES ? clean : 'application/pdf');
    await putObject(key, bytes, clean);
    return { key, mime: clean };
  } catch (err) {
    console.error('messaging media', err);
    return null;
  }
}

async function handleInbound(scope: Scope, m: Messaging, e: InboundMessage) {
  const existing = await inTenant(scope, (tx) => tx.message.findUnique({ where: { externalId: e.id } }));
  if (existing) return; // providers retry webhooks; process each message once
  const contact = await findOrCreateByPhone(scope, e.from, 'WHATSAPP', e.profileName);
  const stored = e.media ? await storeInboundMedia(scope, m, e.media) : null;
  const optOut = /^s*(stop|unsubscribe|stop all)s*$/i.test(e.body);
  const inbound = await inTenant(scope, async (tx) => {
    const msg = await tx.message.create({
      data: {
        tenantId: scope.tenantId,
        ...link(contact),
        channel: m.adapter.channel,
        direction: 'INBOUND',
        body: e.body,
        externalId: e.id,
        status: 'RECEIVED',
        phone: `+${e.from.replace(/\D/g, '')}`,
        mediaType: e.media?.kind ?? null,
        mediaKey: stored?.key ?? null,
        mediaMime: stored?.mime ?? e.media?.mime ?? null,
        mediaName: e.media?.name ?? null,
        // Ordered by arrival; the provider timestamp drives the 24-hour window below.
      },
    });
    // A customer message opens the 24-hour window and counts as opt-in for this business, unless it's STOP.
    const data = optOut ? { waLastInbound: e.at, waOptIn: false, waOptInAt: null } : { waLastInbound: e.at, waOptIn: true };
    if (contact.kind === 'client') await tx.client.update({ where: { id: contact.id }, data });
    else await tx.lead.update({ where: { id: contact.id }, data });
    if (optOut) await logActivity(tx, scope, { type: 'WHATSAPP', summary: 'Contact replied STOP: opted out of WhatsApp messages', ...link(contact) });
    return msg;
  });
  await meter(scope.tenantId, 'messaging', m.provider, 'message', 1, { direction: 'inbound' });
  await m.adapter.markRead(e.id);
  if (!optOut) {
    const { assistOnInbound } = await import('./assistant');
    after(() => assistOnInbound(scope, contact, inbound.id));
  }
}

async function handleStatus(scope: Scope, s: StatusUpdate) {
  const next = s.status.toUpperCase() as keyof typeof STATUS_RANK;
  await inTenant(scope, async (tx) => {
    const msg = await tx.message.findUnique({ where: { externalId: s.id } });
    if (!msg) return;
    // Statuses can arrive out of order; never go backwards (except to FAILED).
    if (next !== 'FAILED' && msg.status && STATUS_RANK[msg.status as keyof typeof STATUS_RANK] >= STATUS_RANK[next]) return;
    await tx.message.update({
      where: { id: msg.id },
      data: { status: next, error: next === 'FAILED' ? (s.error ?? 'Failed') : null, readAt: next === 'READ' ? s.at : msg.readAt },
    });
  });
}

/** Apply normalised events from a verified webhook. */
export async function processMessagingEvents(scope: Scope, events: MessagingEvent[]) {
  const m = await messaging(scope);
  if (!m) return;
  for (const e of events) {
    if (e.type === 'message.received') await handleInbound(scope, m, e);
    else await handleStatus(scope, e);
  }
}

// ── Simulator (sandbox only): builds real, signed Meta-format webhooks ──────

export function simulatorPayload(
  ev: { from: string; name?: string; text?: string; media?: { key: string; mime: string; fileName: string } } | { statusFor: string; status: StatusUpdate['status']; to: string },
): WaWebhook {
  const ts = String(Math.floor(Date.now() / 1000));
  const value: WaWebhook['entry'][number]['changes'][number]['value'] = {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '910000000000', phone_number_id: SANDBOX_PHONE_NUMBER_ID },
  };
  if ('statusFor' in ev) {
    value.statuses = [{ id: ev.statusFor, status: ev.status, timestamp: ts, recipient_id: ev.to.replace(/\D/g, '') }];
  } else {
    const from = ev.from.replace(/\D/g, '');
    const id = `wamid.SIM${randomBytes(10).toString('hex').toUpperCase()}`;
    value.contacts = [{ profile: { name: ev.name }, wa_id: from }];
    value.messages = [
      ev.media
        ? { from, id, timestamp: ts, type: 'document', document: { id: `sandbox:${ev.media.key}`, mime_type: ev.media.mime, filename: ev.media.fileName, caption: ev.text } }
        : { from, id, timestamp: ts, type: 'text', text: { body: ev.text ?? '' } },
    ];
  }
  return { object: 'whatsapp_business_account', entry: [{ id: '200000000000001', changes: [{ field: 'messages', value }] }] };
}

/** Post a signed webhook to our own endpoint, exactly as Meta would. */
export async function postSimulated(scope: Scope, payload: WaWebhook) {
  const m = await messaging(scope);
  if (!m?.sandbox) throw new UserError('The simulator only works with the WhatsApp sandbox');
  const raw = JSON.stringify(payload);
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/webhooks/messaging/${m.provider}/${scope.slug}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(raw, m.config.appSecret!) },
    body: raw,
  });
  if (!res.ok) throw new UserError(`Webhook returned ${res.status}`);
}

export async function sandboxMediaFromUpload(scope: Scope, file: File) {
  const mime = file.type || 'application/pdf';
  if (!(mime in ALLOWED_TYPES)) throw new UserError('Pick a PDF or image');
  const key = newKey(scope.tenantId, 'sandbox', mime);
  await putObject(key, Buffer.from(await file.arrayBuffer()), mime);
  return { key, mime, fileName: file.name };
}

export async function displayContact(tx: Tx, c: Contact) {
  const row = await loadContact(tx, c);
  return { name: fullName(row), phone: row.phoneNormalized, optIn: row.waOptIn, lastInbound: row.waLastInbound };
}

/** Lightweight "is WhatsApp connected" for pages (no adapter construction needed by callers). */
export async function messagingStatus(scope: Pick<Scope, 'tenantId' | 'slug'>) {
  const m = await messaging(scope);
  return m ? { provider: m.provider, sandbox: m.sandbox } : null;
}
