'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@kicko/db';
import type { TenantSettings } from '@kicko/db/provision';
import { z } from 'zod';
import { formObject, run, type ActionResult } from '@/lib/action';
import { can } from '@/lib/permissions';
import { assertCan, db, getCtx, type Ctx } from '@/lib/tenant';
import * as calls from '@/server/calls/service';
import * as assistant from '@/server/whatsapp/assistant';
import * as voice from '@/server/voice/service';
import { saveCheck } from '@/server/eligibility';
import { checkDocumentFile } from '@/server/doc-checks';
import { QUESTIONS, syncAgent as syncVoice, voiceSettings as voiceAgentSettings } from '@/server/voice/agent';
import type { Contact } from '@/server/contacts';
import { parseContactKey } from '@/server/messages';
import { scopeOf, UserError } from '@/server/scope';
import { createDownloadUrl } from '@/server/storage';

type Prev = ActionResult | null;
const refresh = (slug: string) => revalidatePath(`/${slug}`, 'layout');

function assertCanCall(ctx: Ctx, c?: Contact) {
  const ok = c ? can(ctx.role, c.kind === 'client' ? 'client.write' : 'lead.write') : can(ctx.role, 'client.write') || can(ctx.role, 'lead.write');
  if (!ok) throw new UserError("You don't have permission to call this contact");
}

export async function startCallAction(slug: string, key: string, scriptId?: string): Promise<ActionResult<string>> {
  const ctx = await getCtx(slug);
  return run(async () => {
    const c = parseContactKey(key);
    if (!c) throw new UserError('Unknown contact');
    assertCanCall(ctx, c);
    return calls.startCall(scopeOf(ctx), c, { scriptId });
  });
}

/** Polled by the call HUD while a call is live. */
export async function callStatusAction(slug: string, callId: string) {
  const ctx = await getCtx(slug);
  assertCanCall(ctx);
  const c = await db(ctx, (tx) => tx.call.findUnique({ where: { id: callId } }));
  if (!c) return null;
  return {
    aiAgent: c.aiAgent,
    scheduledAt: c.scheduledAt?.toISOString() ?? null,
    status: c.status,
    answeredAt: c.answeredAt?.toISOString() ?? null,
    durationSec: c.durationSec,
    aiStatus: c.aiStatus,
    aiError: c.aiError,
    summary: c.summary,
    hasRecording: Boolean(c.recordingRef),
  };
}

export async function setMyPhoneAction(slug: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    await calls.setMyPhone(scopeOf(ctx), String(fd.get('phone') ?? ''));
  }, 'Saved');
  refresh(slug);
  return res;
}

const callingInput = z.object({
  record: z.literal('on').optional(),
  aiNotes: z.literal('on').optional(),
  greeting: z.string().trim().max(240).optional(),
});

export async function saveCallingSettingsAction(slug: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    const input = callingInput.parse(formObject(fd));
    const settings: TenantSettings = {
      ...ctx.tenant.settings,
      calling: { record: input.record === 'on', aiNotes: input.aiNotes === 'on', greeting: input.greeting || undefined },
    };
    await prisma.tenant.update({ where: { id: ctx.tenant.id }, data: { settings } });
  }, 'Saved');
  refresh(slug);
  return res;
}

export async function simulateInboundCallAction(slug: string, _: Prev, fd: FormData): Promise<ActionResult<string>> {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    return calls.simulateInboundCall(scopeOf(ctx), { from: String(fd.get('from') ?? ''), scriptId: String(fd.get('script') ?? '') });
  }, 'Call simulated');
  refresh(slug);
  return res;
}

export async function addCallTaskAction(slug: string, callId: string, index: number) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'task.write');
    await calls.addSuggestedTask(scopeOf(ctx), callId, index);
  });
  refresh(slug);
  return res;
}

export async function applyCallFieldsAction(slug: string, callId: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCanCall(ctx);
    await calls.applyCallFields(scopeOf(ctx), callId);
  });
  refresh(slug);
  return res;
}

export async function setCallOutcomeAction(slug: string, callId: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCanCall(ctx);
    await calls.setCallOutcome(scopeOf(ctx), callId, String(fd.get('outcome') ?? ''));
  }, 'Saved');
  refresh(slug);
  return res;
}

export async function retryCallNotesAction(slug: string, callId: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCanCall(ctx);
    await calls.retryCallNotes(scopeOf(ctx), callId);
  });
  refresh(slug);
  return res;
}

export async function recordingUrlAction(slug: string, callId: string) {
  const ctx = await getCtx(slug);
  assertCanCall(ctx);
  const c = await db(ctx, (tx) => tx.call.findUnique({ where: { id: callId } }));
  return c?.recordingKey ? createDownloadUrl(c.recordingKey, `call-${c.id}.${c.recordingKey.split('.').pop()}`) : null;
}

// ─── WhatsApp AI assistant ──────────────────────────────────────────────────

const assistantInput = z.object({
  mode: z.enum(['off', 'always', 'after_hours']),
  name: z.string().trim().min(1, 'Give the assistant a name').max(30),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  booking: z.literal('on').optional(),
});

export async function saveAssistantSettingsAction(slug: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    const input = assistantInput.parse(formObject(fd));
    if (input.end <= input.start) throw new UserError('Closing time must be after opening time');
    const days = fd.getAll('days').map(Number).filter((d) => d >= 0 && d <= 6);
    const settings: TenantSettings = {
      ...ctx.tenant.settings,
      assistant: { mode: input.mode, name: input.name, start: input.start, end: input.end, booking: input.booking === 'on', days },
    };
    await prisma.tenant.update({ where: { id: ctx.tenant.id }, data: { settings } });
  }, 'Saved');
  refresh(slug);
  return res;
}

export async function saveKnowledgeAction(slug: string, id: string | null, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    await assistant.saveKnowledge(scopeOf(ctx), id, formObject(fd));
  }, 'Saved');
  refresh(slug);
  return res;
}

export async function toggleKnowledgeAction(slug: string, id: string, active: boolean) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    await assistant.toggleKnowledge(scopeOf(ctx), id, active);
  });
  refresh(slug);
  return res;
}

export async function deleteKnowledgeAction(slug: string, id: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    await assistant.deleteKnowledge(scopeOf(ctx), id);
  });
  refresh(slug);
  return res;
}

export async function seedKnowledgeAction(slug: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    await assistant.seedStarterKnowledge(scopeOf(ctx));
  });
  refresh(slug);
  return res;
}

export async function previewAssistantAction(slug: string, payload: { history: { from: 'customer' | 'assistant'; text: string }[]; message: string }) {
  const ctx = await getCtx(slug);
  return run(async () => {
    assertCan(ctx, 'settings.manage');
    return assistant.previewAssistant(scopeOf(ctx), payload);
  });
}

export async function setAssistantPausedAction(slug: string, key: string, paused: boolean) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    const c = parseContactKey(key);
    if (!c) throw new UserError('Unknown conversation');
    assertCanCall(ctx, c);
    await assistant.setAssistantPaused(scopeOf(ctx), c, paused);
  });
  refresh(slug);
  return res;
}

// ─── AI voice agent ─────────────────────────────────────────────────────────

export async function startAiCallAction(slug: string, key: string, persona?: string): Promise<ActionResult<string>> {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    const c = parseContactKey(key);
    if (!c) throw new UserError('Unknown contact');
    assertCanCall(ctx, c);
    return voice.queueAiCall(scopeOf(ctx), c, { persona });
  });
  refresh(slug);
  return res;
}

const voiceInput = z.object({
  name: z.string().trim().min(1, 'Give the agent a name').max(30),
  language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$|^multi$/, 'Pick a language'),
  voice: z.string().trim().max(100).optional(),
  inbound: z.literal('on').optional(),
  autoCall: z.literal('on').optional(),
  autoCallDelayMin: z.coerce.number().int().min(0).max(240),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  maxAttempts: z.coerce.number().int().min(1).max(3),
});

export async function saveVoiceSettingsAction(slug: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    const input = voiceInput.parse(formObject(fd));
    if (input.end <= input.start) throw new UserError('Calling hours must end after they start');
    // TRAI: promotional and service calls only between 9 am and 9 pm.
    if (input.start < '09:00' || input.end > '21:00') throw new UserError('Calling hours must stay between 09:00 and 21:00');
    const prev = voiceAgentSettings(ctx.tenant.settings);
    const questions = fd.getAll('questions').map(String).filter((q) => q in QUESTIONS);
    const settings: TenantSettings = {
      ...ctx.tenant.settings,
      voiceAgent: {
        ...prev,
        name: input.name,
        language: input.language,
        voice: input.voice ?? '',
        inbound: input.inbound === 'on',
        autoCall: input.autoCall === 'on',
        autoCallDelayMin: input.autoCallDelayMin,
        autoCallSources: fd.getAll('autoCallSources').map(String),
        days: fd.getAll('days').map(Number).filter((d) => d >= 0 && d <= 6),
        start: input.start,
        end: input.end,
        maxAttempts: input.maxAttempts,
        questions,
      },
    };
    await prisma.tenant.update({ where: { id: ctx.tenant.id }, data: { settings } });
  }, 'Saved');
  refresh(slug);
  return res;
}

export async function syncVoiceAgentAction(slug: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    await syncVoice(scopeOf(ctx));
  });
  refresh(slug);
  return res;
}

export async function simulateInboundAiCallAction(slug: string, _: Prev, fd: FormData): Promise<ActionResult<string>> {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    return voice.simulateInboundAiCall(scopeOf(ctx), { from: String(fd.get('from') ?? ''), persona: String(fd.get('persona') ?? '') });
  });
  refresh(slug);
  return res;
}

export async function dispatchDueCallsAction(slug: string): Promise<ActionResult<number>> {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    return voice.dispatchDue(scopeOf(ctx));
  });
  refresh(slug);
  return res;
}

export async function cancelQueuedCallAction(slug: string, callId: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCanCall(ctx);
    await voice.cancelQueuedCall(scopeOf(ctx), callId);
  });
  refresh(slug);
  return res;
}

// ─── Eligibility ────────────────────────────────────────────────────────────

export async function saveEligibilityAction(slug: string, clientId: string, kind: 'CRS' | 'AU_POINTS', inputs: unknown): Promise<ActionResult<string>> {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'client.write');
    if (kind !== 'CRS' && kind !== 'AU_POINTS') throw new UserError('Unknown calculator');
    return saveCheck(scopeOf(ctx), clientId, kind, inputs);
  });
  refresh(slug);
  return res;
}

// ─── AI document checks ─────────────────────────────────────────────────────

export async function recheckDocumentAction(slug: string, fileId: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'document.write');
    await checkDocumentFile(scopeOf(ctx), fileId);
  });
  refresh(slug);
  return res;
}

export async function saveAiFeaturesAction(slug: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    const settings: TenantSettings = { ...ctx.tenant.settings, ai: { docChecks: fd.get('docChecks') === 'on' } };
    await prisma.tenant.update({ where: { id: ctx.tenant.id }, data: { settings } });
  }, 'Saved');
  refresh(slug);
  return res;
}
