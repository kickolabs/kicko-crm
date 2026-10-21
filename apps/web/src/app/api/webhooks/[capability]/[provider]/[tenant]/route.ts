import { NextResponse, type NextRequest } from 'next/server';
import { resolve } from '@/integrations/core/connections';
import type { Capability } from '@/integrations/core/types';
import type { MessagingAdapter } from '@/integrations/messaging/port';
import type { PaymentsAdapter } from '@/integrations/payments/port';
import type { CallbackEvent, TelephonyAdapter, WebhookInput } from '@/integrations/telephony/port';
import type { VoiceAgentAdapter } from '@/integrations/voice/port';
import { voiceAgent } from '@/server/voice/agent';
import { processVoiceWebhook } from '@/server/voice/service';
import { getTenantBySlug } from '@/lib/tenant';
import { processCallEvents, telephony } from '@/server/calls/service';
import { processPaymentEvents } from '@/server/payment-links';
import { systemScope } from '@/server/scope';
import { processMessagingEvents } from '@/server/whatsapp/service';

// One webhook endpoint for every provider, one URL per agency:
//   https://app.kicko.app/api/webhooks/{capability}/{provider}/{workspace}
// The adapter verifies the request with the agency's own secret and turns the
// payload into normalised events; features never see vendor formats.

type Params = { params: Promise<{ capability: string; provider: string; tenant: string }> };

const WEBHOOK_CAPABILITIES: Capability[] = ['messaging', 'payments', 'telephony', 'voice_agent'];
const CALLBACK_EVENTS: CallbackEvent[] = ['inbound', 'status', 'recording', 'dialed'];

async function connection(p: Params['params']) {
  const { capability, provider, tenant: slug } = await p;
  if (!WEBHOOK_CAPABILITIES.includes(capability as Capability)) return null;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return null;
  const r = await resolve<MessagingAdapter | PaymentsAdapter | TelephonyAdapter | VoiceAgentAdapter>(tenant.id, tenant.slug, capability as Capability);
  // The URL names the provider so a stale webhook from a replaced provider is refused.
  if (!r || r.descriptor.id !== provider) return null;
  return { capability: capability as Capability, provider, tenant, adapter: r.adapter };
}

/** The URL the provider called, as configured (behind proxies the Host header may differ). */
function publicUrl(req: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  return new URL(`${req.nextUrl.pathname}${req.nextUrl.search}`, base);
}

/** Query + form/JSON body, flattened (telephony and voice callbacks). */
async function webhookInput(req: NextRequest): Promise<WebhookInput | null> {
  const url = publicUrl(req);
  const raw = req.method === 'GET' ? '' : await req.text();
  const type = req.headers.get('content-type') ?? '';
  const params: Record<string, string> = Object.fromEntries(url.searchParams);
  if (type.includes('application/x-www-form-urlencoded')) Object.assign(params, Object.fromEntries(new URLSearchParams(raw)));
  else if (type.includes('json') && raw) {
    try {
      for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, unknown>)) if (typeof v !== 'object') params[k] = String(v);
    } catch {
      return null;
    }
  }
  return { method: req.method, url, raw, headers: req.headers, params };
}

async function voiceCallback(req: NextRequest, c: NonNullable<Awaited<ReturnType<typeof connection>>>) {
  const adapter = c.adapter as VoiceAgentAdapter;
  const input = await webhookInput(req);
  if (!input) return new NextResponse(null, { status: 400 });
  let w;
  try {
    w = adapter.parseWebhook(input);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (w === null) return new NextResponse('Forbidden', { status: 401 });
  try {
    const scope = systemScope(c.tenant);
    const res = adapter.respond(await processVoiceWebhook(scope, (await voiceAgent(scope))!, w));
    return new NextResponse(res.body, { status: 200, headers: { 'Content-Type': res.contentType } });
  } catch (err) {
    console.error('voice webhook', c.provider, c.tenant.slug, err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

async function telephonyCallback(req: NextRequest, c: NonNullable<Awaited<ReturnType<typeof connection>>>) {
  const adapter = c.adapter as TelephonyAdapter;
  const url = publicUrl(req);
  const raw = req.method === 'GET' ? '' : await req.text();
  const type = req.headers.get('content-type') ?? '';
  const params: Record<string, string> = Object.fromEntries(url.searchParams);
  if (type.includes('application/x-www-form-urlencoded')) Object.assign(params, Object.fromEntries(new URLSearchParams(raw)));
  else if (type.includes('json') && raw) {
    try {
      for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, unknown>)) if (typeof v !== 'object') params[k] = String(v);
    } catch {
      return new NextResponse(null, { status: 400 });
    }
  }
  const input: WebhookInput = { method: req.method, url, raw, headers: req.headers, params };
  let events;
  try {
    events = adapter.parseWebhook(input);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (events === null) return new NextResponse('Forbidden', { status: 401 });
  const event = (CALLBACK_EVENTS.find((e) => e === url.searchParams.get('event')) ?? 'status') as CallbackEvent;
  try {
    const scope = systemScope(c.tenant);
    const t = (await telephony(scope))!;
    const routing = await processCallEvents(scope, t, events);
    const res = adapter.respond(event, routing);
    return new NextResponse(res.body, { status: 200, headers: { 'Content-Type': res.contentType } });
  } catch (err) {
    console.error('telephony webhook', c.provider, c.tenant.slug, err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

/** Subscription handshakes (Meta) and GET callbacks (Exotel applets). */
export async function GET(req: NextRequest, { params }: Params) {
  const c = await connection(params);
  if (c?.capability === 'telephony') return telephonyCallback(req, c);
  if (c?.capability === 'voice_agent') return voiceCallback(req, c);
  const challenge = c?.capability === 'messaging' ? (c.adapter as MessagingAdapter).handshake(req.nextUrl.searchParams) : null;
  if (challenge === null) return new NextResponse('Forbidden', { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

export async function POST(req: NextRequest, { params }: Params) {
  const c = await connection(params);
  if (!c) return new NextResponse(null, { status: 404 });
  if (c.capability === 'telephony') return telephonyCallback(req, c);
  if (c.capability === 'voice_agent') return voiceCallback(req, c);
  const raw = await req.text();
  let events;
  try {
    events = (c.adapter as MessagingAdapter | PaymentsAdapter).parseWebhook(raw, req.headers);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (events === null) return new NextResponse('Invalid signature', { status: 401 });
  const scope = systemScope(c.tenant);
  try {
    if (c.capability === 'messaging') await processMessagingEvents(scope, events as Parameters<typeof processMessagingEvents>[1]);
    else await processPaymentEvents(scope, c.provider, events as Parameters<typeof processPaymentEvents>[2]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('webhook', c.capability, c.provider, c.tenant.slug, err);
    // 500 makes the provider retry; processing is idempotent on provider ids.
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
