import 'server-only';
import { randomBytes } from 'node:crypto';
import type { ProviderDescriptor } from '../core/types';
import { sandboxWav } from '../telephony/sandbox-scripts';
import type { VoiceAgentAdapter, VoiceEvent, VoiceWebhook } from './port';

// Sandbox voice agent: no phones ring. A scripted caller (persona) talks to the
// agent; the agent calls our real tool webhook mid-call and the call-ended
// webhook carries the transcript, exactly like Retell or Bolna would.

export type SandboxVoiceBody =
  | { kind: 'events'; events: VoiceEvent[] }
  | { kind: 'tool'; name: string; args: Record<string, unknown>; callId?: string; callerPhone?: string }
  | { kind: 'inbound'; from: string; to: string; providerCallId: string };

export const voiceSandbox: ProviderDescriptor<VoiceAgentAdapter> = {
  id: 'voice-sandbox',
  capability: 'voice_agent',
  name: 'Voice agent sandbox',
  description: 'Hear how the AI agent qualifies leads and books consultations, with scripted callers. No phones ring.',
  sandbox: true,
  webhookPath: true,
  connectLabel: 'Try the voice agent in sandbox',
  features: { inbound: true, outbound: true, tools: true, simulator: true, languages: ['en-IN'] },
  fields: [{ key: 'webhookToken', label: 'Webhook token', generated: true }],
  setup: (prev) => ({ webhookToken: prev?.webhookToken || randomBytes(16).toString('base64url') }),
  create(cfg): VoiceAgentAdapter {
    return {
      async syncAgent() {
        return { agentId: 'sandbox-agent' };
      },
      async startCall() {
        return { providerCallId: `VA_SBX${randomBytes(10).toString('hex')}` };
      },
      parseWebhook({ url, raw }): VoiceWebhook | null {
        if (url.searchParams.get('token') !== cfg.webhookToken) return null;
        const b = JSON.parse(raw) as SandboxVoiceBody;
        if (b.kind === 'tool') return { kind: 'tool', tool: { name: b.name, args: b.args, callId: b.callId, callerPhone: b.callerPhone } };
        if (b.kind === 'inbound') return { kind: 'inbound', from: b.from, to: b.to, providerCallId: b.providerCallId };
        return { kind: 'events', events: b.events };
      },
      respond(r) {
        return { contentType: 'application/json', body: JSON.stringify(r.kind === 'tool' ? { result: r.result } : r.kind === 'inbound' ? { variables: r.variables } : { ok: true }) };
      },
      async fetchRecording(url) {
        if (!url.startsWith('sandbox-voice:')) throw new Error('Unknown sandbox recording');
        return { bytes: sandboxWav(5), mime: 'audio/wav' };
      },
      async healthCheck() {},
    };
  },
};
