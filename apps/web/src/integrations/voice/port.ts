import type { Segment } from '../stt/port';
import type { CallStatusName, WebhookInput } from '../telephony/port';

// Voice agent port: an AI that holds the phone conversation itself (speech in,
// LLM, speech out) on the provider's infrastructure, and calls our tools mid-call.

export type ToolSpec = {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
  /** Say this while the tool runs (e.g. "One moment, checking the calendar"). */
  speakDuring?: string;
};

export type AgentSpec = {
  name: string;
  language: string;
  voice: string;
  /** First sentence, spoken as soon as the call connects. May use {{variables}}. */
  greeting: string;
  /** System prompt. Per-call values appear as {{variable}} placeholders. */
  prompt: string;
  tools: ToolSpec[];
  toolUrl: (tool: string) => string;
  /** Call lifecycle events (started, ended + transcript). */
  webhookUrl: string;
  /** Inbound-call webhook (personalise before the agent speaks). */
  inboundUrl: string;
  /** Fields the provider extracts after the call. */
  analysis: { name: string; description: string }[];
};

export type RemoteAgent = { agentId: string; llmId?: string };

export type VoiceEvent =
  | { type: 'call.started'; providerCallId: string; callId?: string }
  | {
      type: 'call.ended';
      providerCallId: string;
      callId?: string;
      direction: 'INBOUND' | 'OUTBOUND';
      from: string;
      to: string;
      status: CallStatusName;
      durationSec?: number;
      transcript: Segment[];
      recordingUrl?: string;
      summary?: string;
      extracted?: Record<string, string | number | boolean | null>;
    };

export type ToolRequest = { name: string; args: Record<string, unknown>; providerCallId?: string; callId?: string; callerPhone?: string };

export type VoiceWebhook =
  | { kind: 'events'; events: VoiceEvent[] }
  | { kind: 'tool'; tool: ToolRequest }
  | { kind: 'inbound'; from: string; to: string; providerCallId?: string };

export type VoiceResponse =
  | { kind: 'ack' }
  | { kind: 'tool'; result: unknown }
  | { kind: 'inbound'; variables: Record<string, string>; metadata?: Record<string, string> };

export interface VoiceAgentAdapter {
  /** Create or update the agent on the provider. */
  syncAgent(spec: AgentSpec, existing: RemoteAgent | null): Promise<RemoteAgent>;
  startCall(input: { remote: RemoteAgent; to: string; callId: string; variables: Record<string, string> }): Promise<{ providerCallId: string }>;
  /** Verify and classify a callback. Null = not from this provider/account. */
  parseWebhook(input: WebhookInput): VoiceWebhook | null;
  respond(r: VoiceResponse): { contentType: string; body: string };
  fetchRecording(url: string): Promise<{ bytes: Buffer; mime: string }>;
  healthCheck(): Promise<void>;
}
