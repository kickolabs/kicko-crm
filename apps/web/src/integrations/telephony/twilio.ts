import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ProviderError, type ProviderDescriptor } from '../core/types';
import type { CallEvent, CallStatusName, TelephonyAdapter } from './port';

// Twilio Programmable Voice (overseas numbers). Each agency uses its own account.

const API = 'https://api.twilio.com/2010-04-01';

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

/** X-Twilio-Signature = base64(HMAC-SHA1(authToken, url + sorted POST params as key+value)). */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return createHmac('sha1', authToken).update(data).digest('base64');
}

const STATUS: Record<string, CallStatusName> = {
  queued: 'queued', initiated: 'queued', ringing: 'ringing', 'in-progress': 'in-progress', answered: 'in-progress',
  completed: 'completed', busy: 'busy', 'no-answer': 'no-answer', failed: 'failed', canceled: 'canceled',
};

export const twilio: ProviderDescriptor<TelephonyAdapter> = {
  id: 'twilio',
  capability: 'telephony',
  name: 'Twilio',
  description: 'Numbers in 100+ countries. Best for agencies with offices outside India.',
  docsUrl: 'https://www.twilio.com/docs/voice',
  webhookPath: true,
  webhookSuffix: '?event=inbound&token={webhookToken}',
  guide: [
    'Twilio Console → Account info: copy the Account SID and Auth token.',
    'Buy (or port) a voice number and enter it below as the caller ID.',
    'Phone Numbers → your number → Voice configuration: "A call comes in" → Webhook (HTTP POST) → paste the inbound URL shown here.',
  ],
  features: { inbound: true, recording: true, dualChannel: true, countries: ['*'] },
  fields: [
    { key: 'accountSid', label: 'Account SID', required: true, pattern: '^AC[0-9a-fA-F]{32}$', placeholder: 'AC…' },
    { key: 'authToken', label: 'Auth token', secret: true, required: true },
    { key: 'callerId', label: 'Twilio number (caller ID)', required: true, pattern: '^\\+\\d{8,15}$', placeholder: '+14155550100' },
    { key: 'webhookToken', label: 'Webhook token', generated: true },
  ],
  setup: (prev) => ({ webhookToken: prev?.webhookToken || randomBytes(16).toString('base64url') }),
  create(cfg): TelephonyAdapter {
    const auth = `Basic ${Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64')}`;
    const call = async <T>(path: string, form?: [string, string][]) => {
      const res = await fetch(`${API}/Accounts/${cfg.accountSid}${path}`, {
        method: form ? 'POST' : 'GET',
        headers: { Authorization: auth, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        body: form ? new URLSearchParams(form).toString() : undefined,
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as T & { message?: string };
      if (!res.ok) throw new ProviderError(body.message ?? `Twilio error ${res.status}`, 'twilio');
      return body;
    };
    const dial = (numbers: string[], record: boolean, callbacks: (e: 'recording' | 'dialed') => string) =>
      `<Dial callerId="${esc(cfg.callerId!)}" action="${esc(callbacks('dialed'))}"` +
      (record ? ` record="record-from-answer-dual" recordingStatusCallback="${esc(callbacks('recording'))}" recordingStatusCallbackEvent="completed"` : '') +
      `>${numbers.map((n) => `<Number>${esc(n)}</Number>`).join('')}</Dial>`;

    return {
      async placeCall(i) {
        // Ring the counsellor first; when they answer, TwiML dials the client.
        const twiml = `<Response>${i.greeting ? `<Say>${esc(i.greeting)}</Say>` : ''}${dial([i.contactPhone], i.record, i.callbacks)}</Response>`;
        const r = await call<{ sid: string }>('/Calls.json', [
          ['To', i.agentPhone],
          ['From', cfg.callerId!],
          ['Twiml', twiml],
          ['StatusCallback', i.callbacks('status')],
          ...(['initiated', 'ringing', 'answered', 'completed'].map((e) => ['StatusCallbackEvent', e]) as [string, string][]),
        ]);
        return { providerCallId: r.sid };
      },
      parseWebhook({ url, headers, params }) {
        if (url.searchParams.get('token') !== cfg.webhookToken) return null;
        const body = { ...params };
        for (const k of url.searchParams.keys()) delete body[k];
        const sig = headers.get('x-twilio-signature') ?? '';
        const expected = twilioSignature(cfg.authToken!, url.toString(), body);
        if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

        const event = url.searchParams.get('event');
        const callId = url.searchParams.get('call') ?? undefined;
        const sid = body.CallSid ?? '';
        const out: CallEvent[] = [];
        if (event === 'inbound') out.push({ type: 'call.incoming', providerCallId: sid, from: body.From ?? '', to: body.To ?? '' });
        else if (event === 'recording' && body.RecordingUrl)
          out.push({
            type: 'call.recording',
            providerCallId: sid,
            callId,
            ref: body.RecordingUrl,
            channels: body.RecordingChannels === '2' ? 'dual' : 'mono',
            durationSec: Number(body.RecordingDuration) || undefined,
          });
        else if (event === 'dialed' && body.DialCallStatus)
          out.push({ type: 'call.status', providerCallId: sid, callId, status: STATUS[body.DialCallStatus] ?? 'failed', durationSec: Number(body.DialCallDuration) || undefined });
        else if (event === 'status' && body.CallStatus && STATUS[body.CallStatus])
          out.push({ type: 'call.status', providerCallId: sid, callId, status: STATUS[body.CallStatus]!, durationSec: Number(body.CallDuration) || undefined });
        return out;
      },
      respond(event, routing) {
        if (event !== 'inbound') return { contentType: 'text/xml', body: '<Response/>' };
        if (!routing?.forwardTo.length) {
          return { contentType: 'text/xml', body: '<Response><Say>Sorry, no one is available right now. We will call you back shortly.</Say><Hangup/></Response>' };
        }
        const say = routing.greeting ? `<Say>${esc(routing.greeting)}</Say>` : '';
        return { contentType: 'text/xml', body: `<Response>${say}${dial(routing.forwardTo, routing.record, routing.callbacks)}</Response>` };
      },
      async fetchRecording(ref) {
        const res = await fetch(`${ref}.mp3`, { headers: { Authorization: auth }, signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new ProviderError(`Recording download failed (${res.status})`, 'twilio');
        return { bytes: Buffer.from(await res.arrayBuffer()), mime: 'audio/mpeg' };
      },
      async healthCheck() {
        await call('.json');
      },
    };
  },
};
