import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ProviderError, type ProviderDescriptor } from '../core/types';
import type { Segment } from '../stt/port';
import type { CallStatusName } from '../telephony/port';
import type { VoiceAgentAdapter, VoiceEvent } from './port';

// Retell AI (overseas). Kicko creates and updates the agent (Retell LLM + agent)
// through the API; callbacks are signed with the agency's API key.

const API = 'https://api.retellai.com';

/** x-retell-signature = "v={ms timestamp},d={hex HMAC-SHA256(apiKey, body + timestamp)}", valid for 5 minutes. */
export function retellSignature(body: string, apiKey: string, ts = Date.now()) {
  return `v=${ts},d=${createHmac('sha256', apiKey).update(body + ts).digest('hex')}`;
}

export function verifyRetell(body: string, apiKey: string, header: string | null, now = Date.now()) {
  const m = header?.match(/^v=(\d+),d=([0-9a-f]+)$/);
  if (!m) return false;
  const ts = Number(m[1]);
  if (Math.abs(now - ts) > 5 * 60_000) return false;
  const expected = Buffer.from(createHmac('sha256', apiKey).update(body + ts).digest('hex'));
  const given = Buffer.from(m[2]!);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

type RetellCall = {
  call_id: string;
  direction?: 'inbound' | 'outbound';
  from_number?: string;
  to_number?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  disconnection_reason?: string;
  transcript_object?: { role: 'agent' | 'user'; content: string; words?: { start: number; end: number }[] }[];
  recording_url?: string;
  metadata?: Record<string, string>;
  call_analysis?: { call_summary?: string; custom_analysis_data?: Record<string, string | number | boolean | null> };
};

function statusOf(reason?: string): CallStatusName {
  if (!reason) return 'completed';
  if (reason === 'dial_no_answer' || reason === 'voicemail_reached') return 'no-answer';
  if (reason === 'dial_busy') return 'busy';
  if (reason.startsWith('dial_') || reason.startsWith('error')) return 'failed';
  return 'completed';
}

const segmentsOf = (c: RetellCall): Segment[] =>
  (c.transcript_object ?? []).map((t) => ({
    speaker: t.role === 'agent' ? 'agent' : 'contact',
    start: t.words?.[0]?.start ?? 0,
    end: t.words?.at(-1)?.end ?? 0,
    text: t.content,
  }));

export const retell: ProviderDescriptor<VoiceAgentAdapter> = {
  id: 'retell',
  capability: 'voice_agent',
  name: 'Retell AI',
  description: 'Natural-sounding AI phone agents with numbers in many countries. Best outside India.',
  docsUrl: 'https://docs.retellai.com',
  webhookPath: true,
  webhookSuffix: '?event=inbound&token={webhookToken}',
  guide: [
    'Retell dashboard → Settings → API keys: copy your API key.',
    'Phone numbers: buy or import a number and enter it below.',
    'Save, then press "Sync agent" in the agent settings below. Kicko creates the agent, its tools and webhooks for you.',
    'To answer inbound calls, set the number\'s inbound agent to the synced agent in Retell.',
  ],
  features: { inbound: true, outbound: true, tools: true, languages: ['en-IN', 'en-US', 'en-GB', 'hi-IN', 'multi'] },
  fields: [
    { key: 'apiKey', label: 'API key', secret: true, required: true },
    { key: 'fromNumber', label: 'Retell number', required: true, pattern: '^\\+\\d{8,15}$', placeholder: '+14155550100' },
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
      const json = (await res.json().catch(() => ({}))) as T & { message?: string; error_message?: string };
      if (!res.ok) throw new ProviderError(json.message ?? json.error_message ?? `Retell error ${res.status}`, 'retell');
      return json;
    };
    return {
      async syncAgent(spec, existing) {
        if (!spec.voice) throw new ProviderError('Pick a Retell voice id (Retell dashboard → Voices), e.g. 11labs-Adrian', 'retell');
        const llm = {
          general_prompt: spec.prompt,
          begin_message: spec.greeting,
          general_tools: [
            { type: 'end_call', name: 'end_call', description: 'End the call politely when the conversation is finished.' },
            ...spec.tools.map((t) => ({
              type: 'custom',
              name: t.name,
              description: t.description,
              url: spec.toolUrl(t.name),
              parameters: t.parameters,
              speak_during_execution: Boolean(t.speakDuring),
              execution_message_description: t.speakDuring,
              speak_after_execution: true,
            })),
          ],
        };
        const llmId = existing?.llmId
          ? (await call<{ llm_id: string }>(`/update-retell-llm/${existing.llmId}`, 'PATCH', llm)).llm_id
          : (await call<{ llm_id: string }>('/create-retell-llm', 'POST', llm)).llm_id;
        const agent = {
          agent_name: spec.name,
          response_engine: { type: 'retell-llm', llm_id: llmId },
          voice_id: spec.voice,
          language: spec.language,
          webhook_url: spec.webhookUrl,
          post_call_analysis_data: spec.analysis.map((a) => ({ type: 'string', name: a.name, description: a.description })),
        };
        const agentId = existing?.agentId
          ? (await call<{ agent_id: string }>(`/update-agent/${existing.agentId}`, 'PATCH', agent)).agent_id
          : (await call<{ agent_id: string }>('/create-agent', 'POST', agent)).agent_id;
        return { agentId, llmId };
      },
      async startCall({ remote, to, callId, variables }) {
        const r = await call<{ call_id: string }>('/v2/create-phone-call', 'POST', {
          from_number: cfg.fromNumber,
          to_number: to,
          override_agent_id: remote.agentId,
          metadata: { call_id: callId },
          retell_llm_dynamic_variables: variables,
        });
        return { providerCallId: r.call_id };
      },
      parseWebhook({ url, raw, headers }) {
        if (url.searchParams.get('token') !== cfg.webhookToken) return null;
        if (!verifyRetell(raw, cfg.apiKey!, headers.get('x-retell-signature'))) return null;
        const body = JSON.parse(raw) as {
          event?: string;
          call?: RetellCall;
          call_inbound?: { from_number: string; to_number: string };
          name?: string;
          args?: Record<string, unknown>;
        };
        if (body.event === 'call_inbound' && body.call_inbound) return { kind: 'inbound', from: body.call_inbound.from_number, to: body.call_inbound.to_number };
        if (body.name && body.call) {
          return {
            kind: 'tool',
            tool: { name: body.name, args: body.args ?? {}, providerCallId: body.call.call_id, callId: body.call.metadata?.call_id, callerPhone: body.call.direction === 'inbound' ? body.call.from_number : body.call.to_number },
          };
        }
        const c = body.call;
        if (!c) return { kind: 'events', events: [] };
        const events: VoiceEvent[] = [];
        if (body.event === 'call_started') events.push({ type: 'call.started', providerCallId: c.call_id, callId: c.metadata?.call_id });
        // call_analyzed arrives after call_ended and carries everything, including the analysis.
        if (body.event === 'call_analyzed') {
          events.push({
            type: 'call.ended',
            providerCallId: c.call_id,
            callId: c.metadata?.call_id,
            direction: c.direction === 'inbound' ? 'INBOUND' : 'OUTBOUND',
            from: c.from_number ?? '',
            to: c.to_number ?? '',
            status: statusOf(c.disconnection_reason),
            durationSec: c.start_timestamp && c.end_timestamp ? Math.round((c.end_timestamp - c.start_timestamp) / 1000) : undefined,
            transcript: segmentsOf(c),
            recordingUrl: c.recording_url,
            summary: c.call_analysis?.call_summary,
            extracted: c.call_analysis?.custom_analysis_data,
          });
        }
        return { kind: 'events', events };
      },
      respond(r) {
        if (r.kind === 'inbound') return { contentType: 'application/json', body: JSON.stringify({ call_inbound: { dynamic_variables: r.variables, metadata: r.metadata ?? {} } }) };
        if (r.kind === 'tool') return { contentType: 'application/json', body: JSON.stringify({ result: r.result }) };
        return { contentType: 'application/json', body: '{"ok":true}' };
      },
      async fetchRecording(url) {
        const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new ProviderError(`Recording download failed (${res.status})`, 'retell');
        return { bytes: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type')?.split(';')[0] ?? 'audio/wav' };
      },
      async healthCheck() {
        await call('/list-agents', 'GET');
      },
    };
  },
};
