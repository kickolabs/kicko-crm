import 'server-only';
import { claude } from '../llm/claude';
import type { LlmAdapter } from '../llm/port';
import { sandboxLlm } from '../llm/sandbox';
import { deepgram } from '../stt/deepgram';
import type { SttAdapter } from '../stt/port';
import { sandboxStt } from '../stt/sandbox';

// Platform-owned capabilities: Kicko's own accounts, configured by env, used by every
// agency and metered per agency. Each falls back to its sandbox when no key is set.

export function llm(): LlmAdapter {
  const key = process.env.ANTHROPIC_API_KEY;
  return key ? claude(key) : sandboxLlm;
}

export function stt(): SttAdapter {
  const key = process.env.DEEPGRAM_API_KEY;
  return key ? deepgram(key) : sandboxStt;
}

export const platformStatus = () => ({
  llm: process.env.ANTHROPIC_API_KEY ? `Claude (${process.env.AI_MODEL ?? 'claude-sonnet-5-5'})` : null,
  stt: process.env.DEEPGRAM_API_KEY ? 'Deepgram' : null,
});
