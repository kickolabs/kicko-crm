import 'server-only';
import { ProviderError } from '../core/types';
import type { LlmAdapter } from './port';

// Anthropic Messages API. Structured output uses a forced tool call, so the
// model must return input matching the schema.

const API = 'https://api.anthropic.com/v1/messages';

type ContentBlock = { type: 'text'; text: string } | { type: 'tool_use'; name: string; input: unknown };

export function claude(apiKey: string): LlmAdapter {
  const models = {
    smart: process.env.AI_MODEL ?? 'claude-sonnet-5-5',
    fast: process.env.AI_FAST_MODEL ?? 'claude-haiku-5-5',
  };
  return {
    id: 'anthropic',
    sandbox: false,
    async complete(req) {
      const model = models[req.tier ?? 'smart'];
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          max_tokens: req.maxTokens ?? 1500,
          system: req.system,
          messages: req.attachments?.length
            ? req.messages.map((m, idx) =>
                idx === 0 && m.role === 'user'
                  ? {
                      role: 'user',
                      content: [
                        ...req.attachments!.map((a) =>
                          a.mime === 'application/pdf'
                            ? { type: 'document', source: { type: 'base64', media_type: a.mime, data: a.data } }
                            : { type: 'image', source: { type: 'base64', media_type: a.mime, data: a.data } },
                        ),
                        { type: 'text', text: m.content },
                      ],
                    }
                  : m,
              )
            : req.messages,
          ...(req.output
            ? {
                tools: [{ name: req.output.name, description: req.output.description, input_schema: req.output.schema }],
                tool_choice: { type: 'tool', name: req.output.name },
              }
            : {}),
        }),
        signal: AbortSignal.timeout(90_000),
      });
      const body = (await res.json().catch(() => ({}))) as {
        content?: ContentBlock[];
        usage?: { input_tokens: number; output_tokens: number };
        error?: { message?: string };
      };
      if (!res.ok) throw new ProviderError(body.error?.message ?? `Claude API error ${res.status}`, 'anthropic');
      const blocks = body.content ?? [];
      const tool = blocks.find((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
      return {
        text: blocks.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n'),
        data: tool?.input,
        model,
        usage: { input: body.usage?.input_tokens ?? 0, output: body.usage?.output_tokens ?? 0 },
      };
    },
  };
}
