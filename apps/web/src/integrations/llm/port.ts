// LLM port: text and structured output from a language model. Platform-owned
// (Kicko's key), metered per agency.

export type LlmTier = 'smart' | 'fast';

export type LlmRequest = {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  tier?: LlmTier;
  maxTokens?: number;
  /** Files the model should read (images, PDFs), sent with the first user message. */
  attachments?: { mime: string; data: string /* base64 */ }[];
  /** Ask for a JSON object matching this JSON Schema (returned in `data`). */
  output?: { name: string; description: string; schema: Record<string, unknown> };
};

export type LlmResponse = { text: string; data?: unknown; model: string; usage: { input: number; output: number } };

export interface LlmAdapter {
  id: string;
  /** No real model behind it: callers use their deterministic fallback. */
  sandbox: boolean;
  complete(req: LlmRequest): Promise<LlmResponse>;
}
