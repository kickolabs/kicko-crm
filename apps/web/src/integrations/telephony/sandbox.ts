import 'server-only';
import { randomBytes } from 'node:crypto';
import type { ProviderDescriptor } from '../core/types';
import type { CallEvent, CallStatusName, TelephonyAdapter } from './port';
import { parseSandboxRef, sandboxWav } from './sandbox-scripts';

// Sandbox telephony: no phones ring. Calls play out a scripted conversation through
// real (token-checked) webhooks, so routing, recording, transcripts and AI notes
// can all be exercised end to end.

export type SandboxCallbackBody =
  | { kind: 'incoming'; providerCallId: string; from: string; to: string }
  | { kind: 'status'; providerCallId: string; status: CallStatusName; durationSec?: number; recordingRef?: string };

export const telephonySandbox: ProviderDescriptor<TelephonyAdapter> = {
  id: 'telephony-sandbox',
  capability: 'telephony',
  name: 'Calling sandbox',
  description: 'Try click-to-call, inbound calls, recordings and AI call notes with scripted conversations. No phones ring.',
  sandbox: true,
  webhookPath: true,
  connectLabel: 'Try calling in sandbox',
  webhookSuffix: '?event=inbound&token={webhookToken}',
  features: { inbound: true, recording: true, dualChannel: false, simulator: true },
  fields: [{ key: 'webhookToken', label: 'Webhook token', generated: true }],
  setup: (prev) => ({ webhookToken: prev?.webhookToken || randomBytes(16).toString('base64url') }),
  create(cfg): TelephonyAdapter {
    return {
      async placeCall() {
        return { providerCallId: `CA_SBX${randomBytes(10).toString('hex')}` };
      },
      parseWebhook({ url, raw }) {
        if (url.searchParams.get('token') !== cfg.webhookToken) return null;
        const b = JSON.parse(raw) as SandboxCallbackBody;
        const callId = url.searchParams.get('call') ?? undefined;
        const ev: CallEvent =
          b.kind === 'incoming'
            ? { type: 'call.incoming', providerCallId: b.providerCallId, from: b.from, to: b.to }
            : {
                type: 'call.status',
                providerCallId: b.providerCallId,
                callId,
                status: b.status,
                durationSec: b.durationSec,
                recording: b.recordingRef ? { ref: b.recordingRef, channels: 'mono' } : undefined,
              };
        return [ev];
      },
      respond(event, routing) {
        return { contentType: 'application/json', body: JSON.stringify(event === 'inbound' ? { forwardTo: routing?.forwardTo ?? [] } : { ok: true }) };
      },
      async fetchRecording(ref) {
        if (!parseSandboxRef(ref)) throw new Error('Unknown sandbox recording');
        return { bytes: sandboxWav(4), mime: 'audio/wav' };
      },
      async healthCheck() {},
    };
  },
};
