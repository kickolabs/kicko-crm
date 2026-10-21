import 'server-only';
import { randomBytes } from 'node:crypto';
import { ProviderError, type ProviderDescriptor } from '../core/types';
import type { CallEvent, CallStatusName, TelephonyAdapter } from './port';

// Exotel (India): ExoPhone numbers, click-to-call via Calls/connect, inbound via an
// App Bazaar flow. Exotel doesn't sign callbacks, so every callback URL carries the
// connection's secret token.

const STATUS: Record<string, CallStatusName> = {
  queued: 'queued', ringing: 'ringing', 'in-progress': 'in-progress', completed: 'completed',
  busy: 'busy', 'no-answer': 'no-answer', failed: 'failed', canceled: 'canceled',
};

export const exotel: ProviderDescriptor<TelephonyAdapter> = {
  id: 'exotel',
  capability: 'telephony',
  name: 'Exotel',
  description: 'Indian virtual numbers (ExoPhones), recording and IVR. TRAI/DLT compliant.',
  docsUrl: 'https://developer.exotel.com/api/make-a-call-api',
  webhookPath: true,
  webhookSuffix: '?event=inbound&token={webhookToken}',
  guide: [
    'Exotel dashboard → API settings: copy the Account SID, API key, API token and your API subdomain.',
    'Enter your ExoPhone (virtual number) below as the caller ID.',
    'For inbound calls, create an App Bazaar flow on your ExoPhone: a Connect applet with "Dial whom" set to the inbound URL shown here. Then add a Passthru applet pointing to the same URL with event=dialed instead of event=inbound.',
  ],
  features: { inbound: true, recording: true, dualChannel: true, countries: ['IN'] },
  fields: [
    { key: 'accountSid', label: 'Account SID', required: true },
    { key: 'apiKey', label: 'API key', required: true },
    { key: 'apiToken', label: 'API token', secret: true, required: true },
    { key: 'subdomain', label: 'API subdomain', required: true, placeholder: 'api.exotel.com', pattern: '^api(\\.[a-z]+)?\\.exotel\\.com$', hint: 'api.exotel.com (Singapore) or api.in.exotel.com (Mumbai)' },
    { key: 'callerId', label: 'ExoPhone (caller ID)', required: true, placeholder: '+918047XXXXXX' },
    { key: 'webhookToken', label: 'Webhook token', generated: true },
  ],
  setup: (prev) => ({ webhookToken: prev?.webhookToken || randomBytes(16).toString('base64url') }),
  create(cfg): TelephonyAdapter {
    const base = `https://${cfg.subdomain}/v1/Accounts/${cfg.accountSid}`;
    const auth = `Basic ${Buffer.from(`${cfg.apiKey}:${cfg.apiToken}`).toString('base64')}`;
    const call = async <T>(path: string, form?: Record<string, string>) => {
      const res = await fetch(`${base}${path}`, {
        method: form ? 'POST' : 'GET',
        headers: { Authorization: auth, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        body: form ? new URLSearchParams(form).toString() : undefined,
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as T & { RestException?: { Message?: string } };
      if (!res.ok) throw new ProviderError(body.RestException?.Message ?? `Exotel error ${res.status}`, 'exotel');
      return body;
    };
    const seconds = (v?: string) => (v && Number(v) > 0 ? Number(v) : undefined);

    return {
      async placeCall(i) {
        // Exotel rings From (counsellor) first, then connects To (client).
        const r = await call<{ Call: { Sid: string } }>('/Calls/connect.json', {
          From: i.agentPhone,
          To: i.contactPhone,
          CallerId: cfg.callerId!,
          Record: i.record ? 'true' : 'false',
          RecordingChannels: 'dual',
          StatusCallback: i.callbacks('status'),
          'StatusCallbackEvents[0]': 'terminal',
          StatusCallbackContentType: 'application/json',
          CustomField: i.callId,
        });
        return { providerCallId: r.Call.Sid };
      },
      parseWebhook({ url, params }) {
        if (url.searchParams.get('token') !== cfg.webhookToken) return null;
        const event = url.searchParams.get('event');
        const callId = url.searchParams.get('call') ?? params.CustomField ?? undefined;
        const sid = params.CallSid ?? '';
        const rec = params.RecordingUrl ? { ref: params.RecordingUrl, channels: 'dual' as const } : undefined;
        const out: CallEvent[] = [];
        if (event === 'inbound') out.push({ type: 'call.incoming', providerCallId: sid, from: params.CallFrom ?? params.From ?? '', to: params.CallTo ?? params.To ?? '' });
        else if (event === 'dialed' && params.DialCallStatus)
          out.push({ type: 'call.status', providerCallId: sid, callId, status: STATUS[params.DialCallStatus] ?? 'failed', durationSec: seconds(params.DialCallDuration), recording: rec });
        else if (event === 'status' && params.Status)
          out.push({ type: 'call.status', providerCallId: sid, callId, status: STATUS[params.Status] ?? 'failed', durationSec: seconds(params.ConversationDuration), recording: rec });
        return out;
      },
      respond(event, routing) {
        if (event !== 'inbound') return { contentType: 'text/plain', body: 'OK' };
        // Response format for the Connect applet's dynamic "Dial whom" URL.
        return {
          contentType: 'application/json',
          body: JSON.stringify({
            fetch_after_attempt: false,
            destination: { numbers: routing?.forwardTo ?? [] },
            outgoing_phone_number: cfg.callerId,
            record: Boolean(routing?.record),
            recording_channels: 'dual',
            max_ringing_duration: 45,
            max_conversation_duration: 3600,
            ...(routing?.greeting ? { start_call_playback: { playback_to: 'callee', type: 'text', value: routing.greeting } } : {}),
          }),
        };
      },
      async fetchRecording(ref) {
        const res = await fetch(ref, { headers: { Authorization: auth }, signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new ProviderError(`Recording download failed (${res.status})`, 'exotel');
        return { bytes: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type')?.split(';')[0] ?? 'audio/mpeg' };
      },
      async healthCheck() {
        await call('.json');
      },
    };
  },
};
