import 'server-only';
import { randomBytes } from 'node:crypto';
import { ProviderError, type ProviderDescriptor } from '../core/types';
import type { Segment } from '../stt/port';
import type { CallStatusName } from '../telephony/port';
import type { VoiceAgentAdapter } from './port';

// Bolna (India): voice agents in Indian languages over Indian telephony (Plivo,
// Exotel, Twilio inside Bolna). The agency creates the agent in Bolna (voice,
// language, number); Kicko keeps its prompt, greeting, tools and webhook in sync.
// Bolna doesn't sign callbacks, so every URL carries the connection's secret token.

const API = 'https://api.bolna.ai';

const STATUS: Record<string, CallStatusName> = {
  completed: 'completed', 'call-disconnected': 'completed', 'no-answer': 'no-answer', busy: 'busy',
  failed: 'failed', canceled: 'canceled', cancelled: 'canceled', error: 'failed', 'balance-low': 'failed',
};
const TERMINAL = new Set(Object.keys(STATUS));

/** Bolna fills {variable} from the call's user_data; our prompts use {{variable}}. */
export const toBolnaVars = (s: string) => s.replace(/\{\{(\w+)\}\}/g, '{$1}');

/** "assistant: Hello\nuser: Hi" → segments. */
export function parseBolnaTranscript(t: string | undefined): Segment[] {
  if (!t) return [];
  const out: Segment[] = [];
  for (const line of t.split('\n')) {
    const m = line.match(/^\s*(assistant|agent|bot|user|human)\s*:\s*(.*)$/i);
    if (m) out.push({ speaker: /user|human/i.test(m[1]!) ? 'contact' : 'agent', start: 0, end: 0, text: m[2]!.trim() });
    else if (line.trim() && out.length) out.at(-1)!.text += ` ${line.trim()}`;
  }
  return out;
}

type Execution = {
  id: string;
  status?: string;
  conversation_duration?: number;
  transcript?: string;
  summary?: string;
  extracted_data?: Record<string, string | number | boolean | null>;
  context_details?: { recipient_data?: Record<string, string>; recipient_phone_number?: string };
  telephony_data?: { recording_url?: string; to_number?: string; from_number?: string; call_type?: 'inbound' | 'outbound'; duration?: string | number };
};

export const bolna: ProviderDescriptor<VoiceAgentAdapter> = {
  id: 'bolna',
  capability: 'voice_agent',
  name: 'Bolna',
  description: 'Indian voice AI: Hindi, Tamil, Telugu, English and more, on Indian numbers.',
  docsUrl: 'https://docs.bolna.ai',
  webhookPath: true,
  webhookSuffix: '?event=webhook&token={webhookToken}',
  guide: [
    'In Bolna, create an agent: pick the language, voice and phone number (Plivo/Exotel/Twilio).',
    'Copy the Agent ID from the agent page, and your API key from Developers → API keys.',
    'Save, then press "Sync agent" below. Kicko pushes the prompt, greeting, tools and the webhook URL shown here.',
  ],
  features: { inbound: true, outbound: true, tools: true, languages: ['en-IN', 'hi-IN', 'ta-IN', 'te-IN', 'kn-IN', 'ml-IN', 'bn-IN', 'mr-IN', 'gu-IN', 'pa-IN'] },
  fields: [
    { key: 'apiKey', label: 'API key', secret: true, required: true },
    { key: 'agentId', label: 'Bolna agent ID', required: true },
    { key: 'fromNumber', label: 'Caller number (optional)', placeholder: '+9180…', hint: 'Leave blank to use the agent\'s default number' },
    { key: 'webhookToken', label: 'Webhook token', generated: true },
  ],
  setup: (prev) => ({ webhookToken: prev?.webhookToken || randomBytes(16).toString('base64url') }),
  create(cfg): VoiceAgentAdapter {
    const call = async <T>(path: string, method: string, body?: unknown) => {
      const res = await fetch(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
      const json = (await res.json().catch(() => ({}))) as T & { message?: string; detail?: string };
      if (!res.ok) throw new ProviderError(json.message ?? json.detail ?? `Bolna error ${res.status}`, 'bolna');
      return json;
    };
    return {
      async syncAgent(spec) {
        await call(`/v2/agent/${cfg.agentId}`, 'PATCH', {
          agent_config: {
            agent_name: spec.name,
            agent_welcome_message: toBolnaVars(spec.greeting),
            webhook_url: spec.webhookUrl,
            tasks: [
              {
                task_type: 'conversation',
                tools_config: {
                  api_tools: {
                    tools: spec.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters, key: 'custom_task' })),
                    tools_params: Object.fromEntries(
                      spec.tools.map((t) => [t.name, { method: 'POST', url: spec.toolUrl(t.name), api_token: null, param: JSON.stringify(Object.fromEntries(Object.keys((t.parameters.properties as object) ?? {}).map((k) => [k, `%(${k})s`]))) }]),
                    ),
                  },
                },
              },
            ],
          },
          agent_prompts: { task_1: { system_prompt: toBolnaVars(spec.prompt) } },
        });
        return { agentId: cfg.agentId! };
      },
      async startCall({ to, callId, variables }) {
        const r = await call<{ execution_id?: string; call_id?: string }>('/call', 'POST', {
          agent_id: cfg.agentId,
          recipient_phone_number: to,
          ...(cfg.fromNumber ? { from_phone_number: cfg.fromNumber } : {}),
          user_data: { ...variables, call_ref: callId },
        });
        const id = r.execution_id ?? r.call_id;
        if (!id) throw new ProviderError('Bolna did not return a call id', 'bolna');
        return { providerCallId: id };
      },
      parseWebhook({ url, raw, params }) {
        if (url.searchParams.get('token') !== cfg.webhookToken) return null;
        const event = url.searchParams.get('event');
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        if (event === 'tool') {
          const args = { ...body };
          return {
            kind: 'tool',
            tool: { name: url.searchParams.get('name') ?? '', args, callId: typeof args.call_ref === 'string' ? args.call_ref : undefined, callerPhone: typeof args.caller_phone === 'string' ? args.caller_phone : undefined },
          };
        }
        const e = body as Execution;
        if (!e.id || !e.status || !TERMINAL.has(e.status)) return { kind: 'events', events: [] };
        const t = e.telephony_data ?? {};
        const inbound = t.call_type === 'inbound';
        return {
          kind: 'events',
          events: [
            {
              type: 'call.ended',
              providerCallId: e.id,
              callId: e.context_details?.recipient_data?.call_ref ?? params.call ?? undefined,
              direction: inbound ? 'INBOUND' : 'OUTBOUND',
              from: t.from_number ?? '',
              to: t.to_number ?? e.context_details?.recipient_phone_number ?? '',
              status: STATUS[e.status]!,
              durationSec: Math.round(Number(e.conversation_duration ?? t.duration ?? 0)) || undefined,
              transcript: parseBolnaTranscript(e.transcript),
              recordingUrl: t.recording_url,
              summary: e.summary,
              extracted: e.extracted_data,
            },
          ],
        };
      },
      respond(r) {
        return { contentType: 'application/json', body: JSON.stringify(r.kind === 'tool' ? { result: r.result } : { ok: true }) };
      },
      async fetchRecording(url) {
        const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new ProviderError(`Recording download failed (${res.status})`, 'bolna');
        return { bytes: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type')?.split(';')[0] ?? 'audio/mpeg' };
      },
      async healthCheck() {
        await call(`/v2/agent/${cfg.agentId}`, 'GET');
      },
    };
  },
};
