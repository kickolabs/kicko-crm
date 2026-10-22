import 'server-only';
import { ProviderError } from '../core/types';
import type { LlmAdapter } from './port';

// Kicko's own model: any server that speaks the OpenAI chat-completions API
// (vLLM, Ollama, TGI, Together, Groq…), e.g. a fine-tuned open model hosted in
// Mumbai. Structured output uses a forced function call, like the Claude adapter.

type ToolCall = { function?: { name?: string; arguments?: string } };

export function openaiCompatible(opts: { baseUrl: string; apiKey?: string; model: string }): LlmAdapter {
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return {
    id: 'kicko-model',
    sandbox: false,
    async complete(req) {
      if (req.attachments?.some((a) => a.mime === 'application/pdf')) {
        throw new ProviderError("Kicko's own model can't read PDFs yet", 'kicko-model');
      }
      const messages = [
        { role: 'system', content: req.system },
        ...req.messages.map((m, idx) =>
          idx === 0 && m.role === 'user' && req.attachments?.length
            ? {
                role: 'user',
                content: [
                  ...req.attachments.map((a) => ({ type: 'image_url', image_url: { url: `data:${a.mime};base64,${a.data}` } })),
                  { type: 'text', text: m.content },
                ],
              }
            : m,
        ),
      ];
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}) },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: req.maxTokens ?? 1500,
          messages,
          ...(req.output
            ? {
                tools: [{ type: 'function', function: { name: req.output.name, description: req.output.description, parameters: req.output.schema } }],
                tool_choice: { type: 'function', function: { name: req.output.name } },
              }
            : {}),
        }),
        signal: AbortSignal.timeout(90_000),
      });
      const body = (await res.json().catch(() => ({}))) as {
        choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        error?: { message?: string };
      };
      if (!res.ok) throw new ProviderError(body.error?.message ?? `Model server error ${res.status}`, 'kicko-model');
      const msg = body.choices?.[0]?.message;
      const args = msg?.tool_calls?.find((t) => t.function?.name === req.output?.name)?.function?.arguments;
      let data: unknown;
      if (args) {
        try {
          data = JSON.parse(args);
        } catch {
          throw new ProviderError('Model returned invalid JSON', 'kicko-model');
        }
      }
      return {
        text: msg?.content ?? '',
        data,
        model: opts.model,
        usage: { input: body.usage?.prompt_tokens ?? 0, output: body.usage?.completion_tokens ?? 0 },
      };
    },
  };
}
