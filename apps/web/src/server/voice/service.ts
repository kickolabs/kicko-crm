import 'server-only';
import { after } from 'next/server';
import { countryName } from '@/lib/countries';
import { prisma, type CallStatus, type Prisma, type Tx } from '@kicko/db';
import { webhookUrl } from '@/integrations/core/connections';
import { ProviderError } from '@/integrations/core/types';
import { meter } from '@/integrations/core/usage';
import type { Segment } from '@/integrations/stt/port';
import type { CallStatusName } from '@/integrations/telephony/port';
import type { ToolRequest, VoiceEvent, VoiceResponse, VoiceWebhook } from '@/integrations/voice/port';
import type { SandboxVoiceBody } from '@/integrations/voice/sandbox';
import { CATEGORY_LABEL } from '@/lib/constants';
import { fmtDateTime, fullName, parseLocal, toLocalInput } from '@/lib/format';
import { normalizePhone } from '@/lib/phone';
import { callNotes, detectCategory, detectCountry } from '../ai/call-notes';
import { bookingStaff, bookSlot, suggestSlots } from '../booking';
import { stagesOf } from '../cases';
import { findByPhone, findOrCreateByPhone, type Contact } from '../contacts';
import { inTenant, logActivity, systemScope, UserError, type Scope } from '../scope';
import { newKey, putObject } from '../storage';
import { officeOpen } from '../whatsapp/assistant';
import { QUESTIONS, voiceAgent, voiceSettings, type QuestionKey, type VoiceCfg, type VoiceConn } from './agent';
import { personaById } from './personas';
import { consumeCredits, NO_CREDITS, requireFeature } from '../plan';

// AI voice agent calls: a queue that respects calling hours, outbound qualification,
// an inbound receptionist, tools the agent calls mid-call, and after-call processing
// (transcript → notes → lead fields, status and score).

const TERMINAL: CallStatus[] = ['COMPLETED', 'NO_ANSWER', 'BUSY', 'FAILED', 'CANCELED'];
const STATUS: Record<CallStatusName, CallStatus> = {
  queued: 'QUEUED', ringing: 'RINGING', 'in-progress': 'IN_PROGRESS', completed: 'COMPLETED',
  busy: 'BUSY', 'no-answer': 'NO_ANSWER', failed: 'FAILED', canceled: 'CANCELED',
};
const RETRY_AFTER_MS = 2 * 3600_000;
const PLACEHOLDER_NAMES = ['WhatsApp contact', 'Caller'];

const link = (c: Contact) => (c.kind === 'client' ? { clientId: c.id } : { leadId: c.id });
const contactOf = (c: { leadId: string | null; clientId: string | null }): Contact => (c.clientId ? { kind: 'client', id: c.clientId } : { kind: 'lead', id: c.leadId! });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadContact(tx: Tx, c: Contact) {
  const row = c.kind === 'client' ? await tx.client.findUnique({ where: { id: c.id } }) : await tx.lead.findUnique({ where: { id: c.id } });
  if (!row) throw new UserError('Contact not found');
  return row;
}

// ── Calling hours ───────────────────────────────────────────────────────────

/** Now if inside calling hours, else the next time they open. */
export function nextOpening(cfg: Pick<VoiceCfg, 'days' | 'start' | 'end'>, tz: string, from = new Date()) {
  if (officeOpen(cfg, tz, from)) return from;
  for (let d = 0; d < 8; d++) {
    const date = toLocalInput(new Date(from.getTime() + d * 86400_000), tz, true);
    if (!cfg.days.includes(new Date(`${date}T12:00:00Z`).getUTCDay())) continue;
    const open = parseLocal(`${date}T${cfg.start}`, tz)!;
    if (open > from) return open;
  }
  return new Date(from.getTime() + 86400_000);
}

// ── Per-call variables ──────────────────────────────────────────────────────

async function callVariables(scope: Scope, cfg: VoiceCfg, contact: Contact, callId: string, direction: 'INBOUND' | 'OUTBOUND') {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: scope.tenantId } });
  const { row, known } = await inTenant(scope, async (tx) => {
    const row = await loadContact(tx, contact);
    const known: string[] = [];
    if ('interestCountry' in row) {
      if (row.interestCategory) known.push(`wants: ${CATEGORY_LABEL[row.interestCategory]}`);
      if (row.interestCountry) known.push(`destination: ${countryName(row.interestCountry)}`);
      if (row.message) known.push(`their enquiry: "${row.message.slice(0, 200)}"`);
    } else {
      const cases = await tx.case.findMany({ where: { clientId: contact.id, status: 'OPEN' }, include: { product: true }, take: 2 });
      for (const c of cases) known.push(`existing client, ${c.product.name} case at "${stagesOf(c).find((s) => s.key === c.stageKey)?.name ?? c.stageKey}"`);
    }
    return { row, known };
  });
  const name = PLACEHOLDER_NAMES.includes(fullName(row)) ? '' : fullName(row);
  const first = name.split(' ')[0] ?? '';
  const opening =
    direction === 'OUTBOUND'
      ? `Hi${first ? ` ${first}` : ''}, this is ${cfg.name}, an AI assistant calling from ${tenant.name} about your enquiry. This call is recorded. Is now a good time for two minutes?`
      : `${first ? `Hi ${first}, thank` : 'Thank'} you for calling ${tenant.name}. I'm ${cfg.name}, an AI assistant, and this call is recorded. How can I help you today?`;
  return {
    call_ref: callId,
    contact_name: name || 'unknown',
    contact_first_name: first,
    purpose: direction === 'OUTBOUND' ? 'Follow up their enquiry: qualify it and offer a free consultation.' : 'Answer an inbound call: help the caller, qualify new enquiries, book consultations.',
    known: known.join('; ') || 'nothing yet',
    opening,
    caller_phone: row.phoneNormalized ?? '',
    agency: tenant.name,
  };
}

// ── Queue & dispatch ────────────────────────────────────────────────────────

export async function queueAiCall(scope: Scope, contact: Contact, opts: { delayMin?: number; attempt?: number; when?: Date; persona?: string } = {}) {
  await requireFeature(scope.tenantId, 'voice_agent');
  const conn = await voiceAgent(scope);
  if (!conn) throw new UserError('Connect an AI voice agent in Settings → AI voice agent first');
  const cfg = voiceSettings(scope.settings);
  const row = await inTenant(scope, (tx) => loadContact(tx, contact));
  if (!row.phoneNormalized) throw new UserError('This contact has no phone number');
  const earliest = opts.when ?? new Date(Date.now() + (opts.delayMin ?? 0) * 60_000);
  const scheduledAt = nextOpening(cfg, scope.timezone, earliest);
  const call = await inTenant(scope, async (tx) => {
    const c = await tx.call.create({
      data: {
        tenantId: scope.tenantId,
        provider: conn.provider,
        direction: 'OUTBOUND',
        status: 'QUEUED',
        contactPhone: row.phoneNormalized!,
        aiAgent: true,
        purpose: 'qualify',
        scheduledAt,
        startedAt: scheduledAt,
        attempt: opts.attempt ?? 1,
        agentId: scope.actorId,
        ai: opts.persona ? { sandboxPersona: opts.persona } : undefined,
        ...link(contact),
      },
    });
    const later = scheduledAt.getTime() - Date.now() > 60_000;
    await logActivity(tx, scope, {
      type: 'CALL',
      summary: later ? `AI call scheduled for ${fmtDateTime(scheduledAt, scope.timezone)} (calling hours)` : `AI agent is calling ${fullName(row)}`,
      ...link(contact),
      data: { callId: c.id },
    });
    return c;
  });
  if (scheduledAt.getTime() <= Date.now() + 5_000) after(() => startAiCall(scope, call.id));
  return call.id;
}

export async function startAiCall(scope: Scope, callId: string) {
  // Claim the queued call so two dispatchers can't both dial it.
  const claimed = await inTenant(scope, (tx) => tx.call.updateMany({ where: { id: callId, status: 'QUEUED' }, data: { status: 'RINGING', startedAt: new Date() } }));
  if (!claimed.count) return;
  const call = (await inTenant(scope, (tx) => tx.call.findUnique({ where: { id: callId } })))!;
  try {
    const conn = await voiceAgent(scope);
    if (!conn || conn.provider !== call.provider) throw new UserError('The voice agent provider changed; this call was not placed');
    const cfg = voiceSettings(scope.settings);
    const remote = conn.sandbox ? { agentId: 'sandbox-agent' } : cfg.remote?.provider === conn.provider ? { agentId: cfg.remote.agentId, llmId: cfg.remote.llmId } : null;
    if (!remote) throw new UserError('Sync the agent to the provider first (Settings → AI voice agent)');
    const contact = contactOf(call);
    const { agency: _agency, ...variables } = await callVariables(scope, cfg, contact, callId, 'OUTBOUND');
    const { providerCallId } = await conn.adapter.startCall({ remote, to: call.contactPhone, callId, variables });
    await inTenant(scope, (tx) => tx.call.update({ where: { id: callId }, data: { providerCallId } }));
    if (conn.sandbox) {
      const persona = (call.ai as { sandboxPersona?: string } | null)?.sandboxPersona ?? 'student-canada';
      after(() => playSandboxCall(scope, conn, { callId, providerCallId, persona, direction: 'OUTBOUND', from: '+910000000000', to: call.contactPhone }));
    }
  } catch (err) {
    const error = err instanceof UserError || err instanceof ProviderError ? err.message : 'Could not start the AI call';
    if (!(err instanceof UserError)) console.error('ai call', err);
    await inTenant(scope, async (tx) => {
      await tx.call.update({ where: { id: callId }, data: { status: 'FAILED', endedAt: new Date(), aiError: error } });
      await logActivity(tx, { ...scope, actorId: null }, { type: 'CALL', summary: `AI call failed: ${error}`, ...link(contactOf(call)), data: { callId } });
    });
  }
}

/** Start queued AI calls that are due and inside calling hours. */
export async function dispatchDue(scope: Scope) {
  const cfg = voiceSettings(scope.settings);
  const due = await inTenant(scope, (tx) => tx.call.findMany({ where: { aiAgent: true, status: 'QUEUED', scheduledAt: { lte: new Date() } }, orderBy: { scheduledAt: 'asc' }, take: 20 }));
  let started = 0;
  for (const c of due) {
    if (!officeOpen(cfg, scope.timezone)) {
      await inTenant(scope, (tx) => tx.call.update({ where: { id: c.id }, data: { scheduledAt: nextOpening(cfg, scope.timezone), startedAt: nextOpening(cfg, scope.timezone) } }));
      continue;
    }
    await startAiCall(scope, c.id);
    started++;
  }
  return started;
}

/** Cron entry point (every few minutes). */
export async function runVoiceDispatch() {
  const tenants = await prisma.tenant.findMany();
  const results: Record<string, number | string> = {};
  for (const t of tenants) {
    try {
      const n = await dispatchDue(systemScope(t));
      if (n) results[t.slug] = n;
    } catch (err) {
      console.error('voice dispatch', t.slug, err);
      results[t.slug] = 'error';
    }
  }
  return results;
}

export async function cancelQueuedCall(scope: Scope, callId: string) {
  const r = await inTenant(scope, (tx) => tx.call.updateMany({ where: { id: callId, status: 'QUEUED' }, data: { status: 'CANCELED', endedAt: new Date() } }));
  if (!r.count) throw new UserError('This call has already started');
}

/** New enquiries can get an instant AI call (Settings → AI voice agent). Never throws. */
export async function onLeadCreated(scope: Scope, leadId: string, source: string) {
  try {
    const cfg = voiceSettings(scope.settings);
    if (!cfg.autoCall || !cfg.autoCallSources.includes(source)) return;
    if (!(await voiceAgent(scope))) return;
    await queueAiCall({ ...scope, actorId: null }, { kind: 'lead', id: leadId }, { delayMin: cfg.autoCallDelayMin });
  } catch (err) {
    if (!(err instanceof UserError)) console.error('auto AI call', err);
  }
}

// ── Webhooks ────────────────────────────────────────────────────────────────

async function findCall(tx: Tx, callId: string | undefined, providerCallId: string | undefined) {
  return (callId ? await tx.call.findUnique({ where: { id: callId } }) : null) ?? (providerCallId ? await tx.call.findUnique({ where: { providerCallId } }) : null);
}

export async function processVoiceWebhook(scope: Scope, conn: VoiceConn, w: VoiceWebhook): Promise<VoiceResponse> {
  if (w.kind === 'tool') return { kind: 'tool', result: await runTool(scope, w.tool) };
  if (w.kind === 'inbound') {
    const vars = await handleInbound(scope, conn, w.from, w.providerCallId);
    return { kind: 'inbound', variables: vars, metadata: { call_id: vars.call_ref } };
  }
  for (const e of w.events) {
    if (e.type === 'call.started') {
      await inTenant(scope, async (tx) => {
        const c = await findCall(tx, e.callId, e.providerCallId);
        if (c && !TERMINAL.includes(c.status)) await tx.call.update({ where: { id: c.id }, data: { status: 'IN_PROGRESS', answeredAt: c.answeredAt ?? new Date(), providerCallId: c.providerCallId ?? e.providerCallId } });
      });
    } else await finishCall(scope, conn, e);
  }
  return { kind: 'ack' };
}

async function handleInbound(scope: Scope, conn: VoiceConn, from: string, providerCallId?: string) {
  const contact = await findOrCreateByPhone(scope, from, 'CALL');
  const cfg = voiceSettings(scope.settings);
  const existing = providerCallId ? await inTenant(scope, (tx) => tx.call.findUnique({ where: { providerCallId } })) : null;
  const call =
    existing ??
    (await inTenant(scope, async (tx) => {
      const row = await loadContact(tx, contact);
      const c = await tx.call.create({
        data: {
          tenantId: scope.tenantId,
          provider: conn.provider,
          providerCallId: providerCallId ?? null,
          direction: 'INBOUND',
          status: 'IN_PROGRESS',
          answeredAt: new Date(),
          contactPhone: row.phoneNormalized ?? normalizePhone(from, scope.country) ?? from,
          aiAgent: true,
          purpose: 'reception',
          ...link(contact),
        },
      });
      await logActivity(tx, scope, { type: 'CALL', summary: `Incoming call answered by the AI agent: ${fullName(row)}`, ...link(contact), data: { callId: c.id } });
      return c;
    }));
  const { agency: _agency, ...vars } = await callVariables(scope, cfg, contact, call.id, 'INBOUND');
  return vars;
}

type Facts = Partial<Record<QuestionKey | 'first_name' | 'last_name' | 'email' | 'notes', string>> & { interested?: boolean | string | null };

/** Copy what the caller said onto the lead. Notes only once, at the end of the call. */
async function applyFacts(tx: Tx, scope: Scope, contact: Contact, f: Facts, opts: { note?: string }) {
  const notInterested = f.interested === false || f.interested === 'no' || f.interested === 'false';
  if (contact.kind === 'lead') {
    const lead = await tx.lead.findUnique({ where: { id: contact.id } });
    if (lead && !lead.clientId) {
      const data: Prisma.LeadUpdateInput = {};
      const country = f.destination ? detectCountry(f.destination) : null;
      const category = f.visa_type ? detectCategory(f.visa_type) : null;
      if (country) data.interestCountry = country;
      if (category) data.interestCategory = category;
      if (f.first_name && PLACEHOLDER_NAMES.includes(fullName(lead))) {
        data.firstName = f.first_name.slice(0, 60);
        data.lastName = f.last_name?.slice(0, 60) ?? null;
      }
      if (f.email && /^\S+@\S+\.\S+$/.test(f.email) && !lead.email) data.email = f.email.toLowerCase();
      if (notInterested && lead.status !== 'WON') {
        data.status = 'LOST';
        data.lostReason = 'Not interested (AI call)';
      } else if (lead.status === 'NEW') data.status = country && category ? 'QUALIFIED' : 'CONTACTED';
      data.score = leadScore({ ...f, destination: f.destination ?? (lead.interestCountry ? 'x' : undefined), visa_type: f.visa_type ?? (lead.interestCategory ? 'x' : undefined) }, lead.status === 'CONSULT_BOOKED');
      await tx.lead.update({ where: { id: contact.id }, data });
    }
  }
  if (opts.note) await tx.note.create({ data: { tenantId: scope.tenantId, body: opts.note, ...link(contact) } });
}

/** 0–100: how complete and warm the enquiry is. */
export function leadScore(f: Facts, booked: boolean) {
  if (f.interested === false || f.interested === 'no') return 5;
  let s = 10;
  if (f.destination) s += 15;
  if (f.visa_type) s += 15;
  if (f.intake) s += 10;
  if (f.english_test) s += 10;
  if (f.education) s += 10;
  if (f.budget) s += 10;
  if (booked) s += 20;
  return Math.min(100, s);
}

function factsNote(f: Facts) {
  const lines = (Object.keys(QUESTIONS) as QuestionKey[]).filter((k) => f[k]).map((k) => `${QUESTIONS[k].label}: ${f[k]}`);
  if (f.notes) lines.push(f.notes);
  return lines.length ? `From AI voice call:\n${lines.join('\n')}` : undefined;
}

async function finishCall(scope: Scope, conn: VoiceConn, e: Extract<VoiceEvent, { type: 'call.ended' }>) {
  let call = await inTenant(scope, (tx) => findCall(tx, e.callId, e.providerCallId));
  if (!call) {
    // Inbound on a provider without a pre-call webhook: create the call now.
    const contact = await findOrCreateByPhone(scope, e.direction === 'INBOUND' ? e.from : e.to, 'CALL');
    call = await inTenant(scope, async (tx) => {
      const row = await loadContact(tx, contact);
      return tx.call.create({
        data: { tenantId: scope.tenantId, provider: conn.provider, providerCallId: e.providerCallId, direction: e.direction, status: 'IN_PROGRESS', contactPhone: row.phoneNormalized ?? e.from, aiAgent: true, purpose: e.direction === 'INBOUND' ? 'reception' : 'qualify', ...link(contact) },
      });
    });
  }
  if (call.endedAt && TERMINAL.includes(call.status)) return; // providers resend terminal callbacks
  const contact = contactOf(call);
  const next = STATUS[e.status];
  const now = new Date();
  await inTenant(scope, (tx) =>
    tx.call.update({
      where: { id: call.id },
      data: {
        status: next,
        endedAt: now,
        durationSec: e.durationSec ?? null,
        answeredAt: next === 'COMPLETED' ? (call.answeredAt ?? new Date(now.getTime() - (e.durationSec ?? 0) * 1000)) : call.answeredAt,
        providerCallId: call.providerCallId ?? e.providerCallId,
        transcript: e.transcript.length ? e.transcript : undefined,
        recordingRef: e.recordingUrl ?? null,
        aiStatus: next === 'COMPLETED' && e.transcript.length ? 'pending' : null,
      },
    }),
  );

  if (next !== 'COMPLETED') {
    const cfg = voiceSettings(scope.settings);
    const retry = call.direction === 'OUTBOUND' && (next === 'NO_ANSWER' || next === 'BUSY') && call.attempt < cfg.maxAttempts;
    await inTenant(scope, (tx) =>
      logActivity(tx, { ...scope, actorId: null }, { type: 'CALL', summary: `AI call not answered (${next.replace('_', ' ').toLowerCase()})${retry ? '. Will try again later.' : ''}`, ...link(contact), data: { callId: call.id } }),
    );
    if (retry) {
      const persona = (call.ai as { sandboxPersona?: string } | null)?.sandboxPersona;
      await queueAiCall({ ...scope, actorId: null }, contact, { when: new Date(Date.now() + RETRY_AFTER_MS), attempt: call.attempt + 1, persona: persona === 'no-answer' ? 'student-canada' : persona });
    }
    return;
  }

  if (e.durationSec) await meter(scope.tenantId, 'voice_agent', conn.provider, 'minute', Math.ceil(e.durationSec / 60), { direction: call.direction });

  // Keep our own copy of the recording (best effort).
  if (e.recordingUrl) {
    try {
      const rec = await conn.adapter.fetchRecording(e.recordingUrl);
      const key = newKey(scope.tenantId, 'calls', rec.mime);
      await putObject(key, rec.bytes, rec.mime);
      await inTenant(scope, (tx) => tx.call.update({ where: { id: call.id }, data: { recordingKey: key, recordingMime: rec.mime } }));
    } catch (err) {
      console.error('voice recording', err);
    }
  }
  if (!e.transcript.length) return;

  try {
    const person = await inTenant(scope, (tx) => loadContact(tx, contact));
    if (!(await consumeCredits(scope.tenantId, 'voice_notes', { callId: call.id }))) {
      await inTenant(scope, (tx) => tx.call.update({ where: { id: call.id }, data: { aiStatus: 'skipped', aiError: NO_CREDITS } }));
      return;
    }
    const notes = await callNotes(scope.tenantId, e.transcript, { contactName: fullName(person), direction: call.direction });
    const actions = ((call.ai as { actions?: string[] } | null)?.actions ?? []) as string[];
    const summary = notes.sandbox && e.summary ? e.summary : notes.data.summary;
    const extracted = Object.fromEntries(Object.entries(e.extracted ?? {}).filter(([, v]) => v !== null && v !== '').map(([k, v]) => [k, typeof v === 'string' ? v : String(v)])) as Facts;
    if (e.extracted && 'interested' in e.extracted) extracted.interested = e.extracted.interested as string;
    await inTenant(scope, async (tx) => {
      await applyFacts(tx, scope, contact, extracted, { note: factsNote(extracted) });
      await tx.call.update({
        where: { id: call.id },
        data: { summary, ai: { ...notes.data, summary, model: notes.model, sandbox: notes.sandbox, added: [], actions }, aiStatus: 'done', aiError: null },
      });
      await logActivity(tx, { ...scope, actorId: null }, { type: 'CALL', summary: `AI voice agent: ${summary.slice(0, 180)}`, ...link(contact), data: { callId: call.id } });
    });
  } catch (err) {
    console.error('voice notes', err);
    await inTenant(scope, (tx) => tx.call.update({ where: { id: call.id }, data: { aiStatus: 'failed', aiError: err instanceof Error ? err.message.slice(0, 300) : 'Notes failed' } }));
  }
}

// ── Tools the agent calls mid-call ──────────────────────────────────────────

async function recordAction(tx: Tx, callId: string, action: string) {
  const c = await tx.call.findUnique({ where: { id: callId } });
  const ai = (c?.ai as Record<string, unknown> | null) ?? {};
  await tx.call.update({ where: { id: callId }, data: { ai: { ...ai, actions: [...((ai.actions as string[]) ?? []), action] } } });
}

export async function runTool(scope: Scope, t: ToolRequest): Promise<unknown> {
  const callId = typeof t.args.call_ref === 'string' ? t.args.call_ref : t.callId;
  let call = await inTenant(scope, (tx) => findCall(tx, callId, t.providerCallId));
  if (!call && t.callerPhone) {
    const c = await findByPhone(scope, normalizePhone(t.callerPhone, scope.country)!);
    if (c) call = await inTenant(scope, (tx) => tx.call.findFirst({ where: { ...link(c), aiAgent: true }, orderBy: { createdAt: 'desc' } }));
  }
  if (!call) return { error: 'Unknown call. Continue the conversation without this tool.' };
  const contact = contactOf(call);
  const a = t.args as Record<string, string | boolean | undefined>;

  switch (t.name) {
    case 'get_caller_context':
      return inTenant(scope, async (tx) => {
        const row = await loadContact(tx, contact);
        const name = PLACEHOLDER_NAMES.includes(fullName(row)) ? null : fullName(row);
        const appt = await tx.appointment.findFirst({ where: { ...link(contact), status: 'SCHEDULED', startsAt: { gt: new Date() } }, orderBy: { startsAt: 'asc' } });
        const cases =
          contact.kind === 'client'
            ? await tx.case.findMany({
                where: { clientId: contact.id, status: 'OPEN' },
                include: { product: true, documents: { where: { required: true, status: { in: ['PENDING', 'REJECTED'] } }, take: 5 } },
                take: 3,
              })
            : [];
        return {
          name,
          type: contact.kind === 'client' ? 'existing client' : 'enquiry',
          cases: cases.map((c) => ({ visa: `${countryName(c.product.country)} ${c.product.name}`, stage: stagesOf(c).find((s) => s.key === c.stageKey)?.name ?? c.stageKey, documents_still_needed: c.documents.map((d) => d.name) })),
          next_appointment: appt ? fmtDateTime(appt.startsAt, scope.timezone) : null,
        };
      });

    case 'save_lead_details':
      await inTenant(scope, async (tx) => {
        await applyFacts(tx, scope, contact, a as Facts, {});
        await recordAction(tx, call.id, 'Saved details');
      });
      return { saved: true };

    case 'get_available_slots': {
      const row = await inTenant(scope, (tx) => loadContact(tx, contact));
      const s = await suggestSlots(scope, row.ownerId, 6);
      return s.slots.length ? { slots: s.slots.map((x) => ({ slot_id: x.iso, label: x.label })) } : { slots: [], message: 'No online slots. Offer a counsellor callback instead.' };
    }

    case 'book_appointment': {
      const row = await inTenant(scope, (tx) => loadContact(tx, contact));
      const mode = a.mode === 'VIDEO' || a.mode === 'PHONE' ? a.mode : 'IN_PERSON';
      try {
        const appt = await bookSlot({ ...scope, actorId: null }, { contact, ownerId: row.ownerId, startsAt: String(a.slot_id), mode, topic: 'Booked by the AI voice agent', via: 'AI voice agent' });
        await inTenant(scope, async (tx) => {
          if (contact.kind === 'lead') {
            const lead = await tx.lead.findUnique({ where: { id: contact.id } });
            if (lead && !lead.clientId && lead.status !== 'WON') await tx.lead.update({ where: { id: contact.id }, data: { status: 'CONSULT_BOOKED', score: Math.min(100, (lead.score ?? 30) + 20) } });
          }
          await recordAction(tx, call.id, `Booked ${fmtDateTime(appt.startsAt, scope.timezone)}`);
        });
        return { booked: true, when: fmtDateTime(appt.startsAt, scope.timezone), mode };
      } catch (err) {
        return { booked: false, message: err instanceof UserError ? err.message : 'Could not book. Offer a counsellor callback.' };
      }
    }

    case 'request_human_callback': {
      const reason = String(a.reason ?? 'Asked for a counsellor').slice(0, 160);
      await inTenant(scope, async (tx) => {
        const row = await loadContact(tx, contact);
        const assignee = await bookingStaff(scope, row.ownerId);
        await tx.task.create({ data: { tenantId: scope.tenantId, title: `Call back: ${fullName(row)} (${reason})`, dueAt: new Date(), priority: 1, assigneeId: assignee, ...link(contact) } });
        await logActivity(tx, { ...scope, actorId: null }, { type: 'CALL', summary: `AI agent requested a human callback: ${reason}`, ...link(contact), data: { callId: call.id } });
        await recordAction(tx, call.id, 'Requested a human callback');
      });
      return { ok: true, message: 'A counsellor will call them back.' };
    }

    default:
      return { error: `Unknown tool ${t.name}` };
  }
}

// ── Sandbox: scripted callers through the real webhook endpoint ─────────────

async function postSandbox(scope: Scope, conn: VoiceConn, event: 'webhook' | 'tool' | 'inbound', body: SandboxVoiceBody, name?: string) {
  const url = `${webhookUrl('voice_agent', conn.provider, scope.slug)}?${new URLSearchParams({ event, token: conn.config.webhookToken ?? '', ...(name ? { name } : {}) })}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Voice webhook returned ${res.status}`);
  return (await res.json()) as { result?: unknown; variables?: Record<string, string> };
}

async function playSandboxCall(
  scope: Scope,
  conn: VoiceConn,
  c: { callId: string; providerCallId: string; persona: string; direction: 'INBOUND' | 'OUTBOUND'; from: string; to: string; opening?: string },
) {
  try {
    const p = personaById(c.persona);
    const cfg = voiceSettings(scope.settings);
    const ended = (status: CallStatusName, transcript: Segment[], durationSec?: number, extracted?: Record<string, string>) =>
      postSandbox(scope, conn, 'webhook', {
        kind: 'events',
        events: [{ type: 'call.ended', providerCallId: c.providerCallId, callId: c.callId, direction: c.direction, from: c.from, to: c.to, status, transcript, durationSec, recordingUrl: status === 'completed' ? `sandbox-voice:${p.id}` : undefined, extracted }],
      });
    await pause(500);
    if (p.noAnswer) return void (await ended('no-answer', []));
    await postSandbox(scope, conn, 'webhook', { kind: 'events', events: [{ type: 'call.started', providerCallId: c.providerCallId, callId: c.callId }] });

    const turns: Segment[] = [];
    let t = 0;
    const say = (speaker: 'agent' | 'contact', text: string) => {
      const len = Math.max(3, Math.round(text.split(' ').length / 2.5));
      turns.push({ speaker, start: t, end: t + len, text });
      t += len + 1;
    };
    const tool = async (name: string, args: Record<string, unknown>) => (await postSandbox(scope, conn, 'tool', { kind: 'tool', name, args: { call_ref: c.callId, ...args } }, name)).result as Record<string, unknown>;

    const opening = c.opening ?? (await callVariables(scope, cfg, contactOf((await inTenant(scope, (tx) => tx.call.findUnique({ where: { id: c.callId } })))!), c.callId, c.direction)).opening;
    say('agent', opening);
    if (c.direction === 'INBOUND') await tool('get_caller_context', {});
    say('contact', p.opener);
    if (p.notInterested) {
      say('agent', 'No problem at all, thank you for letting us know. Wishing you all the best!');
      await tool('save_lead_details', { interested: false, notes: 'Already joined another agency' });
      return void (await ended('completed', turns, t, { interested: 'no' }));
    }
    say('agent', 'Great, thank you! Just a few quick questions so the right counsellor can help you.');
    const asked: Record<string, string> = {};
    for (const q of cfg.questions as QuestionKey[]) {
      const answer = p.answers[q];
      if (!answer || !(q in QUESTIONS)) continue;
      say('agent', QUESTIONS[q].ask);
      say('contact', answer);
      asked[q] = answer;
    }
    await tool('save_lead_details', { ...asked, ...(p.email ? { email: p.email } : {}), interested: true });
    if (p.human) {
      say('contact', `Can a counsellor call me? ${p.human.replace(/^Wants/, 'I want')}.`);
      say('agent', "Of course. I've asked a counsellor to call you back soon.");
      await tool('request_human_callback', { reason: p.human });
    }
    if (p.books) {
      say('agent', 'Would you like a free consultation with one of our counsellors?');
      say('contact', 'Yes, please.');
      const r = await tool('get_available_slots', {});
      const slots = (r.slots as { slot_id: string; label: string }[] | undefined) ?? [];
      if (slots.length >= 2) {
        say('agent', `I have ${slots[0]!.label} or ${slots[1]!.label}. Which works better for you?`);
        const word = p.books === 'VIDEO' ? 'by video' : p.books === 'PHONE' ? 'on the phone' : 'at your office';
        say('contact', `${slots[1]!.label} works, ${word} please.`);
        const b = await tool('book_appointment', { slot_id: slots[1]!.slot_id, mode: p.books });
        say('agent', b.booked ? `Done! You're booked for ${b.when} ${word}. We'll send you a reminder.` : 'Sorry, that time just got taken. A counsellor will call you to fix a time.');
      } else say('agent', 'Our calendar is full right now, so a counsellor will call you to fix a time.');
    }
    say('agent', 'Thank you for your time. Have a great day!');
    await ended('completed', turns, t, { ...asked, interested: 'yes' });
  } catch (err) {
    console.error('sandbox voice call', err);
  }
}

/** Simulate someone calling the agency's AI receptionist (sandbox only). */
export async function simulateInboundAiCall(scope: Scope, input: { from: string; persona: string }) {
  const conn = await voiceAgent(scope);
  if (!conn?.sandbox) throw new UserError('The simulator only works with the voice agent sandbox');
  const from = normalizePhone(input.from, scope.country);
  if (!from || from.replace(/\D/g, '').length < 8) throw new UserError('Enter a phone number, e.g. +91 98765 43210');
  const providerCallId = `VA_SBX_IN${Date.now().toString(36)}`;
  const r = await postSandbox(scope, conn, 'inbound', { kind: 'inbound', from, to: '+910000000000', providerCallId });
  const vars = r.variables ?? {};
  if (!vars.call_ref) throw new UserError('The call was not recorded');
  after(() => playSandboxCall(scope, conn, { callId: vars.call_ref!, providerCallId, persona: input.persona, direction: 'INBOUND', from, to: '+910000000000', opening: vars.opening }));
  return vars.call_ref;
}
