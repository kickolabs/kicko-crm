import 'server-only';
import { z } from 'zod';
import { llmFor, type AiTask } from '@/integrations/core/platform';
import { meter } from '@/integrations/core/usage';
import type { LlmTier } from '@/integrations/llm/port';

// One way to run an AI task: structured output validated by zod, tokens metered
// per agency, and a deterministic fallback when no model is configured (sandbox).

export type AiResult<T> = { data: T; model: string; sandbox: boolean };

export async function runStructured<T>(opts: {
  tenantId: string;
  task: AiTask;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  tier?: LlmTier;
  maxTokens?: number;
  attachments?: { mime: string; data: string }[];
  fallback: () => T;
}): Promise<AiResult<T>> {
  const model = llmFor(opts.task);
  if (model.sandbox) return { data: opts.schema.parse(opts.fallback()), model: 'sandbox', sandbox: true };

  const { $schema: _drop, ...schema } = z.toJSONSchema(opts.schema) as Record<string, unknown>;
  const res = await model.complete({
    system: opts.system,
    messages: [{ role: 'user', content: opts.prompt }],
    tier: opts.tier,
    maxTokens: opts.maxTokens,
    attachments: opts.attachments,
    output: { name: `record_${opts.task}`, description: `Record the ${opts.task.replace(/_/g, ' ')}`, schema },
  });
  await meter(opts.tenantId, 'llm', model.id, 'input_token', res.usage.input, { task: opts.task, model: res.model });
  await meter(opts.tenantId, 'llm', model.id, 'output_token', res.usage.output, { task: opts.task, model: res.model });
  const parsed = opts.schema.safeParse(res.data);
  if (!parsed.success) throw new Error(`AI returned an unexpected shape for ${opts.task}`);
  return { data: parsed.data, model: res.model, sandbox: false };
}
