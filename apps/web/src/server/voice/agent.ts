import 'server-only';
import { createHash } from 'node:crypto';
import { prisma } from '@kicko/db';
import type { TenantSettings } from '@kicko/db/provision';
import { resolve, webhookUrl } from '@/integrations/core/connections';
import { ProviderError } from '@/integrations/core/types';
import type { AgentSpec, ToolSpec, VoiceAgentAdapter } from '@/integrations/voice/port';
import { inTenant, UserError, type Scope } from '../scope';

// The AI voice agent's definition: what it asks, how it behaves, which tools it
// may call. Built from the agency's settings and knowledge base, then synced to
// the provider (Retell/Bolna). The sandbox uses it as is.

export const QUESTIONS = {
  destination: { label: 'Destination country', ask: 'Which country are you planning to go to?' },
  visa_type: { label: 'Visa type', ask: 'Are you looking to study, work, settle permanently, visit, or join family?' },
  intake: { label: 'Intake or timeline', ask: 'When would you like to go? Which intake or month?' },
  education: { label: 'Highest education', ask: 'What is your highest qualification, and when did you complete it?' },
  english_test: { label: 'English test score', ask: 'Have you taken IELTS, PTE or TOEFL? What was your score?' },
  budget: { label: 'Budget', ask: 'Roughly what budget do you have in mind for fees and living costs?' },
  work_experience: { label: 'Work experience', ask: 'Do you have any work experience? How many years, and in which field?' },
  best_time: { label: 'Best time for a callback', ask: 'What is the best time for one of our counsellors to call you?' },
} as const;
export type QuestionKey = keyof typeof QUESTIONS;

export const DEFAULT_VOICE_AGENT: NonNullable<TenantSettings['voiceAgent']> = {
  name: 'Asha',
  language: 'en-IN',
  voice: '',
  questions: ['destination', 'visa_type', 'intake', 'education', 'english_test', 'budget'],
  inbound: true,
  autoCall: false,
  autoCallDelayMin: 2,
  autoCallSources: ['WEB_FORM', 'ADS'],
  days: [1, 2, 3, 4, 5, 6],
  start: '10:00',
  end: '19:00',
  maxAttempts: 2,
};
export const voiceSettings = (s: TenantSettings) => ({ ...DEFAULT_VOICE_AGENT, ...s.voiceAgent });
export type VoiceCfg = ReturnType<typeof voiceSettings>;

export async function voiceAgent(scope: Pick<Scope, 'tenantId' | 'slug'>) {
  const r = await resolve<VoiceAgentAdapter>(scope.tenantId, scope.slug, 'voice_agent');
  return r ? { adapter: r.adapter, provider: r.descriptor.id, name: r.descriptor.name, sandbox: Boolean(r.descriptor.sandbox), config: r.config } : null;
}
export type VoiceConn = NonNullable<Awaited<ReturnType<typeof voiceAgent>>>;

const ref = { type: 'string', description: 'Always pass {{call_ref}} exactly.' };

export const TOOLS: ToolSpec[] = [
  {
    name: 'get_caller_context',
    description: "Look up who is calling (inbound calls): name, enquiry, case stage, documents still needed, next appointment. Call this first on inbound calls.",
    parameters: { type: 'object', properties: { call_ref: ref, caller_phone: { type: 'string', description: 'Caller number, {{caller_phone}}' } }, required: ['call_ref'] },
  },
  {
    name: 'save_lead_details',
    description: 'Save what the caller told you. Call it as soon as you learn something, and again before the call ends.',
    parameters: {
      type: 'object',
      properties: {
        call_ref: ref,
        first_name: { type: 'string' },
        last_name: { type: 'string' },
        email: { type: 'string' },
        ...Object.fromEntries(Object.entries(QUESTIONS).map(([k, q]) => [k, { type: 'string', description: q.label }])),
        interested: { type: 'boolean', description: 'false if they clearly said they are not interested' },
        notes: { type: 'string', description: 'Anything else useful, in one or two sentences' },
      },
      required: ['call_ref'],
    },
  },
  {
    name: 'get_available_slots',
    description: 'Get free consultation times. Read out two or three of them naturally.',
    parameters: { type: 'object', properties: { call_ref: ref }, required: ['call_ref'] },
    speakDuring: 'One moment, let me check the calendar.',
  },
  {
    name: 'book_appointment',
    description: 'Book the consultation time the caller chose.',
    parameters: {
      type: 'object',
      properties: {
        call_ref: ref,
        slot_id: { type: 'string', description: 'slot_id from get_available_slots' },
        mode: { type: 'string', enum: ['IN_PERSON', 'VIDEO', 'PHONE'] },
      },
      required: ['call_ref', 'slot_id', 'mode'],
    },
    speakDuring: 'Booking that for you now.',
  },
  {
    name: 'request_human_callback',
    description: 'Ask a human counsellor to call back: they want a person, have a complaint, or asked something you cannot answer.',
    parameters: { type: 'object', properties: { call_ref: ref, reason: { type: 'string' } }, required: ['call_ref', 'reason'] },
  },
];

export async function buildPrompt(scope: Scope, cfg: VoiceCfg) {
  const [tenant, knowledge] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: scope.tenantId } }),
    inTenant(scope, (tx) => tx.knowledgeItem.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' }, take: 40 })),
  ]);
  const asks = cfg.questions.filter((q): q is QuestionKey => q in QUESTIONS).map((q) => `- ${QUESTIONS[q].label}: "${QUESTIONS[q].ask}"`);
  const prompt = `You are ${cfg.name}, an AI voice assistant for ${tenant.name}, a visa and immigration consultancy. You speak on the phone with people who enquired, and with callers.

THIS CALL
- Purpose: {{purpose}}
- Person: {{contact_name}}
- What we already know: {{known}}
- Call reference for every tool: {{call_ref}}

HOW TO TALK
- You already greeted them and said you are an AI assistant and that the call is recorded. If they object to talking to an AI or being recorded, apologise, use request_human_callback, and end the call.
- Warm, calm and brief. One question at a time. Short sentences: this is a phone call.
- Speak the caller's language (English, Hindi, Tamil, and so on), matching how they speak.
- If they are busy, ask for a better time, save it as best_time, and end politely.
- If they are not interested, thank them, save interested=false, and end. Never push.

QUALIFY (skip anything already known)
${asks.join('\n') || '- (no questions configured)'}
Save answers with save_lead_details as you go.

THEN
- Offer a free consultation with a counsellor: get_available_slots, read two or three times, then book_appointment with their choice and confirm the day and time.
- If they want a person, have a complaint, or ask something not covered below, use request_human_callback and tell them a counsellor will call.

NEVER
- Never give immigration advice, eligibility opinions, points estimates or visa guarantees.
- Never invent fees, requirements or processing times. Only use the agency answers below.

AGENCY ANSWERS
${knowledge.map((k) => `Q: ${k.question}\nA: ${k.answer}`).join('\n') || '(none)'}`;
  return { prompt, agency: tenant.name };
}

export async function agentSpec(scope: Scope, cfg: VoiceCfg, conn: VoiceConn): Promise<AgentSpec> {
  const { prompt } = await buildPrompt(scope, cfg);
  const base = webhookUrl('voice_agent', conn.provider, scope.slug);
  const q = (extra: Record<string, string>) => `${base}?${new URLSearchParams({ ...extra, token: conn.config.webhookToken ?? '' })}`;
  return {
    name: `${cfg.name} (Kicko)`,
    language: cfg.language,
    voice: cfg.voice,
    greeting: '{{opening}}',
    prompt,
    tools: TOOLS,
    toolUrl: (name) => q({ event: 'tool', name }),
    webhookUrl: q({ event: 'webhook' }),
    inboundUrl: q({ event: 'inbound' }),
    analysis: [
      ...Object.entries(QUESTIONS).map(([name, x]) => ({ name, description: x.label })),
      { name: 'interested', description: 'yes / no / unsure' },
    ],
  };
}

export const specHash = (spec: AgentSpec) =>
  createHash('sha256').update(JSON.stringify({ ...spec, toolUrl: spec.toolUrl('x') })).digest('hex').slice(0, 16);

/** Push the agent to the provider. Sandbox needs no sync. */
export async function syncAgent(scope: Scope) {
  const conn = await voiceAgent(scope);
  if (!conn) throw new UserError('Connect a voice agent provider first');
  const cfg = voiceSettings(scope.settings);
  const spec = await agentSpec(scope, cfg, conn);
  const existing = cfg.remote?.provider === conn.provider ? { agentId: cfg.remote.agentId, llmId: cfg.remote.llmId } : null;
  let remote;
  try {
    remote = await conn.adapter.syncAgent(spec, existing);
  } catch (err) {
    throw new UserError(err instanceof ProviderError ? `${conn.name}: ${err.message}` : 'Could not reach the provider');
  }
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: scope.tenantId } });
  const settings = tenant.settings as TenantSettings;
  await prisma.tenant.update({
    where: { id: scope.tenantId },
    data: { settings: { ...settings, voiceAgent: { ...cfg, remote: { provider: conn.provider, ...remote, syncedAt: new Date().toISOString(), hash: specHash(spec) } } } },
  });
}

/** Is the provider's copy of the agent up to date with settings and knowledge base? */
export async function syncStatus(scope: Scope) {
  const conn = await voiceAgent(scope);
  if (!conn) return { state: 'none' as const };
  if (conn.sandbox) return { state: 'sandbox' as const };
  const cfg = voiceSettings(scope.settings);
  if (!cfg.remote || cfg.remote.provider !== conn.provider) return { state: 'never' as const };
  const hash = specHash(await agentSpec(scope, cfg, conn));
  return { state: hash === cfg.remote.hash ? ('synced' as const) : ('stale' as const), at: cfg.remote.syncedAt };
}
