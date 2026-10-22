import 'server-only';
import { claude } from '../llm/claude';
import { openaiCompatible } from '../llm/openai-compatible';
import type { LlmAdapter } from '../llm/port';
import { msg91 } from '../otp/msg91';
import type { OtpAdapter } from '../otp/port';
import { sandboxOtp } from '../otp/sandbox';
import { sandboxLlm } from '../llm/sandbox';
import { deepgram } from '../stt/deepgram';
import type { SttAdapter } from '../stt/port';
import { sandboxStt } from '../stt/sandbox';
import type { PlatformBillingAdapter } from '../platform-billing/port';
import { razorpayPlatform } from '../platform-billing/razorpay';
import { billingSandbox } from '../platform-billing/sandbox';

// Platform-owned capabilities: Kicko's own accounts, configured by env, used by every
// agency and metered per agency. Each falls back to its sandbox when no key is set.

export function llm(): LlmAdapter {
  const key = process.env.ANTHROPIC_API_KEY;
  return key ? claude(key) : sandboxLlm;
}

/** AI tasks: whatsapp_reply, call_notes, document_check, copilot_brief, eligibility_explanation. */
export type AiTask = 'whatsapp_reply' | 'call_notes' | 'document_check' | 'copilot_brief' | 'eligibility_explanation';

/**
 * The model for one task. Tasks listed in KICKO_MODEL_TASKS go to Kicko's own
 * model (KICKO_MODEL_URL, an OpenAI-compatible server); everything else to Claude.
 * So one task can move to a fine-tuned model without touching the others.
 */
export function llmFor(task: AiTask): LlmAdapter {
  const { KICKO_MODEL_URL: url, KICKO_MODEL_NAME: model, KICKO_MODEL_KEY: apiKey, KICKO_MODEL_TASKS: tasks } = process.env;
  const routed = (tasks ?? '').split(',').map((t) => t.trim()).includes(task);
  return url && model && routed ? openaiCompatible({ baseUrl: url, model, apiKey }) : llm();
}

export function stt(): SttAdapter {
  const key = process.env.DEEPGRAM_API_KEY;
  return key ? deepgram(key) : sandboxStt;
}

/** Sign-up verification codes by SMS (MSG91). Sandbox shows the code on screen. */
export function otp(): OtpAdapter {
  const { MSG91_AUTH_KEY: key, MSG91_OTP_TEMPLATE_ID: template } = process.env;
  return key && template ? msg91(key, template) : sandboxOtp;
}

export const platformStatus = () => ({
  llm: process.env.ANTHROPIC_API_KEY ? `Claude (${process.env.AI_MODEL ?? 'claude-sonnet-5-5'})` : null,
  ownModel: process.env.KICKO_MODEL_URL && process.env.KICKO_MODEL_TASKS ? `${process.env.KICKO_MODEL_NAME} for ${process.env.KICKO_MODEL_TASKS}` : null,
  stt: process.env.DEEPGRAM_API_KEY ? 'Deepgram' : null,
});

/** Kicko's own subscription billing (agencies paying Kicko). */
export function platformBilling(): PlatformBillingAdapter {
  const { RAZORPAY_PLATFORM_KEY_ID: id, RAZORPAY_PLATFORM_KEY_SECRET: secret, RAZORPAY_PLATFORM_WEBHOOK_SECRET: hook } = process.env;
  return id && secret && hook ? razorpayPlatform(id, secret, hook) : billingSandbox();
}
