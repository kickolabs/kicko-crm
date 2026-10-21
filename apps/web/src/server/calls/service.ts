import 'server-only';
import { after } from 'next/server';
import { prisma, type CallStatus, type Prisma, type Tx } from '@kicko/db';
import type { TenantSettings } from '@kicko/db/provision';
import { resolve, webhookUrl } from '@/integrations/core/connections';
import { stt } from '@/integrations/core/platform';
import { ProviderError } from '@/integrations/core/types';
import { meter } from '@/integrations/core/usage';
import type { CallbackEvent, CallEvent, Callbacks, CallStatusName, Routing, TelephonyAdapter } from '@/integrations/telephony/port';
import type { SandboxCallbackBody } from '@/integrations/telephony/sandbox';
import { sandboxRecordingRef, scriptById } from '@/integrations/telephony/sandbox-scripts';
import { fullName } from '@/lib/format';
import { normalizePhone } from '@/lib/phone';
import { callNotes, type CallNotes } from '../ai/call-notes';
import { findOrCreateByPhone, type Contact } from '../contacts';
import { inTenant, logActivity, UserError, type Scope } from '../scope';
import { newKey, putObject } from '../storage';
import { consumeCredits, featureOn, NO_CREDITS, requireFeature } from '../plan';

// Calls on top of the telephony port: click-to-call bridges, inbound routing,
// recordings, and AI call notes (recording → transcript → summary, tasks, fields).

export const DEFAULT_CALLING = { record: true, greeting: 'This call may be recorded for quality and training.', aiNotes: true };
export const callingSettings = (s: TenantSettings) => ({ ...DEFAULT_CALLING, ...s.calling });

export type CallAi = CallNotes & { model: string; sandbox: boolean; added?: number[] };

const TERMINAL: CallStatus[] = ['COMPLETED', 'NO_ANSWER', 'BUSY', 'FAILED', 'CANCELED'];
const STATUS: Record<CallStatusName, CallStatus> = {
  queued: 'QUEUED', ringing: 'RINGING', 'in-progress': 'IN_PROGRESS', completed: 'COMPLETED',
  busy: 'BUSY', 'no-answer': 'NO_ANSWER', failed: 'FAILED', canceled: 'CANCELED',
};

export async function telephony(scope: Pick<Scope, 'tenantId' | 'slug'>) {
  const r = await resolve<TelephonyAdapter>(scope.tenantId, scope.slug, 'telephony');
  return r ? { adapter: r.adapter, provider: r.descriptor.id, name: r.descriptor.name, sandbox: Boolean(r.descriptor.sandbox), config: r.config, dual: Boolean(r.descriptor.features.dualChannel) } : null;
}
type Telephony = NonNullable<Awaited<ReturnType<typeof telephony>>>;

function callbacksFor(scope: Scope, t: Telephony, callId?: string): Callbacks {
  return (event) => `${webhookUrl('telephony', t.provider, scope.slug)}?${new URLSearchParams({ event, token: t.config.webhookToken ?? '', ...(callId ? { call: callId } : {}) })}`;
}

const link = (c: Contact) => (c.kind === 'client' ? { clientId: c.id } : { leadId: c.id });
const contactOf = (call: { leadId: string | null; clientId: string | null }): Contact =>
  call.clientId ? { kind: 'client', id: call.clientId } : { kind: 'lead', id: call.leadId! };

async function loadContact(tx: Tx, c: Contact) {
  const row = c.kind === 'client' ? await tx.client.findUnique({ where: { id: c.id } }) : await tx.lead.findUnique({ where: { id: c.id } });
  if (!row) throw new UserError('Contact not found');
  return row;
}

export const fmtDuration = (s: number | null | undefined) => (s ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : '0s');

// ── Staff phone (click-to-call rings this first) ────────────────────────────

export async function setMyPhone(scope: Scope, raw: string) {
  const phone = raw.trim() ? normalizePhone(raw, scope.country) : null;
  if (raw.trim() && (!phone || phone.replace(/\D/g, '').length < 8)) throw new UserError('Enter your mobile number with country code');
  await inTenant(scope, (tx) => tx.membership.update({ where: { tenantId_userId: { tenantId: scope.tenantId, userId: scope.actorId! } }, data: { phone } }));
}

// ── Outbound ────────────────────────────────────────────────────────────────

export async function startCall(scope: Scope, contact: Contact, opts: { scriptId?: string } = {}) {
  await requireFeature(scope.tenantId, 'calling');
  const t = await telephony(scope);
  if (!t) throw new UserError('Connect a calling provider in Settings → Calling first');
  const cfg = callingSettings(scope.settings);
  const { row, me } = await inTenant(scope, async (tx) => ({
    row: await loadContact(tx, contact),
    me: await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: scope.tenantId, userId: scope.actorId! } } }),
  }));
  if (!row.phoneNormalized) throw new UserError('This contact has no phone number');
  if (!me?.phone && !t.sandbox) throw new UserError('Add your mobile number first: we ring you, then connect the client');

  const call = await inTenant(scope, (tx) =>
    tx.call.create({
      data: { tenantId: scope.tenantId, provider: t.provider, direction: 'OUTBOUND', contactPhone: row.phoneNormalized!, agentId: scope.actorId, agentPhone: me?.phone ?? null, ...link(contact) },
    }),
  );
  let providerCallId: string;
  try {
    ({ providerCallId } = await t.adapter.placeCall({
      callId: call.id,
      agentPhone: me?.phone ?? '+910000000000',
      contactPhone: row.phoneNormalized,
      record: cfg.record,
      greeting: cfg.record ? cfg.greeting : undefined,
      callbacks: callbacksFor(scope, t, call.id),
    }));
  } catch (err) {
    const error = err instanceof ProviderError ? err.message : 'Could not reach the calling provider';
    await inTenant(scope, (tx) => tx.call.update({ where: { id: call.id }, data: { status: 'FAILED', endedAt: new Date(), aiError: error } }));
    throw new UserError(`${t.name}: ${error}`);
  }
  await inTenant(scope, async (tx) => {
    await tx.call.update({ where: { id: call.id }, data: { providerCallId, status: 'RINGING' } });
    await logActivity(tx, scope, { type: 'CALL', summary: `Outgoing call to ${fullName(row)}`, ...link(contact), data: { callId: call.id } });
  });

  if (t.sandbox) {
    const names = await sandboxNames(scope, scope.actorId, row.firstName);
    after(() => playSandboxCall(scope, t, call.id, providerCallId, opts.scriptId ?? 'study-canada', names));
  }
  return call.id;
}

// ── Provider callbacks ──────────────────────────────────────────────────────

/** Apply verified callback events. Returns routing for an inbound call. */
export async function processCallEvents(scope: Scope, t: Telephony, events: CallEvent[]): Promise<Routing | null> {
  let routing: Routing | null = null;
  for (const e of events) {
    if (e.type === 'call.incoming') routing = await handleIncoming(scope, t, e);
    else if (e.type === 'call.status') await handleStatus(scope, t, e);
    else await handleRecording(scope, e.callId, e.providerCallId, e.ref);
  }
  return routing;
}

async function handleIncoming(scope: Scope, t: Telephony, e: Extract<CallEvent, { type: 'call.incoming' }>): Promise<Routing> {
  const cfg = callingSettings(scope.settings);
  const existing = e.providerCallId ? await inTenant(scope, (tx) => tx.call.findUnique({ where: { providerCallId: e.providerCallId } })) : null;
  const contact = existing ? contactOf(existing) : await findOrCreateByPhone(scope, e.from, 'CALL');

  const { forwardTo, call } = await inTenant(scope, async (tx) => {
    const row = await loadContact(tx, contact);
    const members = await tx.membership.findMany({ where: { active: true, phone: { not: null } }, orderBy: { createdAt: 'asc' } });
    // The contact's owner first; otherwise ring everyone who has a phone set.
    const owner = members.find((m) => m.userId === row.ownerId);
    const targets = owner ? [owner] : members.slice(0, 5);
    const call =
      existing ??
      (await tx.call.create({
        data: {
          tenantId: scope.tenantId,
          provider: t.provider,
          providerCallId: e.providerCallId || null,
          direction: 'INBOUND',
          status: 'RINGING',
          contactPhone: row.phoneNormalized ?? normalizePhone(e.from, scope.country) ?? e.from,
          agentId: targets.length === 1 ? targets[0]!.userId : null,
          agentPhone: targets.length === 1 ? targets[0]!.phone : null,
          ...link(contact),
        },
      }));
    if (!existing) await logActivity(tx, scope, { type: 'CALL', summary: `Incoming call from ${fullName(row)}`, ...link(contact), data: { callId: call.id } });
    return { forwardTo: targets.map((m) => m.phone!), call };
  });
  return { callId: call.id, forwardTo, record: cfg.record, greeting: cfg.record ? cfg.greeting : undefined, callbacks: callbacksFor(scope, t, call.id) };
}

async function findCall(tx: Tx, callId: string | undefined, providerCallId: string) {
  return (callId ? await tx.call.findUnique({ where: { id: callId } }) : null) ?? (providerCallId ? await tx.call.findUnique({ where: { providerCallId } }) : null);
}

async function handleStatus(scope: Scope, t: Telephony, e: Extract<CallEvent, { type: 'call.status' }>) {
  const next = STATUS[e.status];
  const done = await inTenant(scope, async (tx) => {
    const call = await findCall(tx, e.callId, e.providerCallId);
    if (!call) return null;
    const cur = call.status;
    // Terminal states stick; a specific failure (busy, no answer…) beats a generic "completed".
    if (TERMINAL.includes(cur) && (!TERMINAL.includes(next) || cur !== 'COMPLETED' || next === 'COMPLETED')) {
      if (e.recording && !call.recordingRef) await tx.call.update({ where: { id: call.id }, data: { recordingRef: e.recording.ref } });
      return e.recording && !call.recordingRef ? { call, first: false } : null;
    }
    if (!TERMINAL.includes(next) && STATUS_ORDER.indexOf(next) <= STATUS_ORDER.indexOf(cur)) return null;
    const now = new Date();
    const data: Prisma.CallUpdateInput = { status: next };
    if (next === 'IN_PROGRESS' && !call.answeredAt) data.answeredAt = now;
    if (TERMINAL.includes(next)) {
      data.endedAt = now;
      if (e.durationSec) data.durationSec = e.durationSec;
      if (next === 'COMPLETED' && !call.answeredAt) data.answeredAt = e.durationSec ? new Date(now.getTime() - e.durationSec * 1000) : now;
    }
    if (e.recording) data.recordingRef = e.recording.ref;
    if (e.providerCallId && !call.providerCallId) data.providerCallId = e.providerCallId;
    const updated = await tx.call.update({ where: { id: call.id }, data });
    const first = TERMINAL.includes(next) && !TERMINAL.includes(cur);
    if (first) {
      const row = await loadContact(tx, contactOf(call));
      const what =
        next === 'COMPLETED'
          ? `${call.direction === 'INBOUND' ? 'Incoming' : 'Outgoing'} call with ${fullName(row)}, ${fmtDuration(e.durationSec)}`
          : `${call.direction === 'INBOUND' ? 'Missed call from' : 'Call not answered:'} ${fullName(row)} (${next.replace('_', ' ').toLowerCase()})`;
      await logActivity(tx, { ...scope, actorId: call.agentId }, { type: 'CALL', summary: what, ...link(contactOf(call)), data: { callId: call.id } });
    }
    return TERMINAL.includes(next) ? { call: updated, first } : null;
  });
  if (!done) return;
  if (done.first && done.call.durationSec) await meter(scope.tenantId, 'telephony', t.provider, 'minute', Math.ceil(done.call.durationSec / 60), { direction: done.call.direction });
  if (done.call.recordingRef && done.call.status === 'COMPLETED') queuePipeline(scope, done.call.id);
}

const STATUS_ORDER: CallStatus[] = ['QUEUED', 'RINGING', 'IN_PROGRESS'];

async function handleRecording(scope: Scope, callId: string | undefined, providerCallId: string, ref: string) {
  const call = await inTenant(scope, async (tx) => {
    const c = await findCall(tx, callId, providerCallId);
    return c && !c.recordingRef ? tx.call.update({ where: { id: c.id }, data: { recordingRef: ref } }) : null;
  });
  if (call) queuePipeline(scope, call.id);
}

function queuePipeline(scope: Scope, callId: string) {
  after(() => runCallPipeline(scope, callId));
}

// ── Recording → transcript → AI notes ───────────────────────────────────────

export async function runCallPipeline(scope: Scope, callId: string) {
  const call = await inTenant(scope, (tx) => tx.call.findUnique({ where: { id: callId }, include: { lead: true, client: true } }));
  if (!call?.recordingRef || call.aiStatus === 'pending' || call.aiStatus === 'done') return;
  const fail = (aiStatus: 'failed' | 'skipped', aiError: string) => inTenant(scope, (tx) => tx.call.update({ where: { id: callId }, data: { aiStatus, aiError } }));
  try {
    await inTenant(scope, (tx) => tx.call.update({ where: { id: callId }, data: { aiStatus: 'pending', aiError: null } }));
    const t = await telephony(scope);
    if (!t || t.provider !== call.provider) return await fail('failed', 'The calling provider for this recording is no longer connected');

    let key = call.recordingKey;
    let mime = call.recordingMime ?? 'audio/mpeg';
    let bytes: Buffer | null = null;
    if (!key) {
      const rec = await t.adapter.fetchRecording(call.recordingRef);
      bytes = rec.bytes;
      mime = rec.mime;
      key = newKey(scope.tenantId, 'calls', mime);
      await putObject(key, bytes, mime);
      await inTenant(scope, (tx) => tx.call.update({ where: { id: callId }, data: { recordingKey: key, recordingMime: mime } }));
    }
    if (!callingSettings(scope.settings).aiNotes) return await fail('skipped', 'AI call notes are turned off in Settings → Calling');
    if (!(await featureOn(scope.tenantId, 'call_notes'))) return await fail('skipped', 'AI call notes are part of the Growth plan. The recording is saved.');
    if (!(await consumeCredits(scope.tenantId, 'call_notes', { callId }))) return await fail('skipped', NO_CREDITS);

    const { getObject } = await import('../storage');
    const speech = stt();
    const transcript = await speech.transcribe({ bytes: bytes ?? (await getObject(key)), mime, channels: t.dual ? 'dual' : 'mono', sourceRef: call.recordingRef });
    if (!transcript) return await fail('skipped', 'Transcription is not set up yet (DEEPGRAM_API_KEY)');
    if (!speech.sandbox) await meter(scope.tenantId, 'stt', speech.id, 'minute', Math.max(1, Math.ceil((transcript.durationSec ?? call.durationSec ?? 60) / 60)));
    if (!transcript.segments.length) return await fail('skipped', 'No speech found in the recording');

    const person = call.client ?? call.lead!;
    const notes = await callNotes(scope.tenantId, transcript.segments, { contactName: fullName(person), direction: call.direction });
    const ai: CallAi = { ...notes.data, model: notes.model, sandbox: notes.sandbox, added: [] };
    await inTenant(scope, async (tx) => {
      await tx.call.update({
        where: { id: callId },
        data: { transcript: transcript.segments, language: transcript.language ?? null, summary: notes.data.summary, ai, aiStatus: 'done', aiError: null },
      });
      await logActivity(tx, { ...scope, actorId: null }, { type: 'CALL', summary: `AI call notes: ${notes.data.summary.slice(0, 180)}`, ...link(contactOf(call)), data: { callId } });
    });
  } catch (err) {
    console.error('call pipeline', callId, err);
    await fail('failed', err instanceof Error ? err.message.slice(0, 300) : 'AI notes failed');
  }
}

// ── Acting on AI notes ──────────────────────────────────────────────────────

export async function addSuggestedTask(scope: Scope, callId: string, index: number) {
  return inTenant(scope, async (tx) => {
    const call = await tx.call.findUnique({ where: { id: callId } });
    const ai = call?.ai as CallAi | null;
    const t = ai?.tasks[index];
    if (!call || !ai || !t) throw new UserError('Suggestion not found');
    if (ai.added?.includes(index)) return;
    await tx.task.create({
      data: {
        tenantId: scope.tenantId,
        title: t.title,
        dueAt: new Date(Date.now() + t.dueInDays * 86400_000),
        assigneeId: call.agentId ?? scope.actorId,
        createdBy: scope.actorId,
        ...link(contactOf(call)),
      },
    });
    await tx.call.update({ where: { id: callId }, data: { ai: { ...ai, added: [...(ai.added ?? []), index] } } });
  });
}

/** Copy what the caller said onto the lead (country, category) and a note with the rest. */
export async function applyCallFields(scope: Scope, callId: string) {
  return inTenant(scope, async (tx) => {
    const call = await tx.call.findUnique({ where: { id: callId } });
    const f = (call?.ai as CallAi | null)?.fields;
    if (!call || !f) throw new UserError('No AI notes for this call');
    if (call.leadId) {
      await tx.lead.update({
        where: { id: call.leadId },
        data: { ...(f.interestCountry ? { interestCountry: f.interestCountry } : {}), ...(f.interestCategory ? { interestCategory: f.interestCategory } : {}) },
      });
    }
    const facts = [
      f.intake && `Intake: ${f.intake}`, f.englishTest && `English test: ${f.englishTest}`, f.budget && `Budget: ${f.budget}`,
      f.occupation && `Occupation: ${f.occupation}`, f.age && `Age: ${f.age}`,
    ].filter(Boolean);
    if (facts.length) {
      await tx.note.create({ data: { tenantId: scope.tenantId, body: `From call on ${call.startedAt.toISOString().slice(0, 10)}:\n${facts.join('\n')}`, authorId: scope.actorId, leadId: call.leadId, clientId: call.clientId } });
    }
    await logActivity(tx, scope, { type: 'CALL', summary: 'Details from AI call notes applied', ...link(contactOf(call)), data: { callId } });
  });
}

export async function setCallOutcome(scope: Scope, callId: string, outcome: string) {
  await inTenant(scope, (tx) => tx.call.update({ where: { id: callId }, data: { outcome: outcome.trim().slice(0, 200) || null } }));
}

export async function retryCallNotes(scope: Scope, callId: string) {
  await inTenant(scope, (tx) => tx.call.update({ where: { id: callId }, data: { aiStatus: null, aiError: null } }));
  await runCallPipeline(scope, callId);
}

// ── Sandbox: scripted calls through the real webhook endpoint ───────────────

async function sandboxNames(scope: Scope, agentId: string | null, contactFirst: string) {
  const [tenant, agent] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: scope.tenantId } }),
    agentId ? prisma.user.findUnique({ where: { id: agentId } }) : null,
  ]);
  return { agent: agent?.name.split(' ')[0] ?? 'Counsellor', contact: contactFirst, agency: tenant?.name ?? 'the agency' };
}

async function postSandbox(scope: Scope, t: Telephony, event: CallbackEvent, callId: string | undefined, body: SandboxCallbackBody) {
  const res = await fetch(callbacksFor(scope, t, callId)(event), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Sandbox webhook returned ${res.status}`);
  return res.json().catch(() => null) as Promise<unknown>;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function playSandboxCall(scope: Scope, t: Telephony, callId: string | undefined, providerCallId: string, scriptId: string, names: { agent: string; contact: string; agency: string }) {
  try {
    const script = scriptById(scriptId);
    await pause(700);
    await postSandbox(scope, t, 'status', callId, { kind: 'status', providerCallId, status: 'in-progress' });
    await pause(1200);
    await postSandbox(scope, t, 'status', callId, {
      kind: 'status',
      providerCallId,
      status: 'completed',
      durationSec: script.durationSec,
      recordingRef: callingSettings(scope.settings).record ? sandboxRecordingRef(script.id, names) : undefined,
    });
  } catch (err) {
    console.error('sandbox call', err);
  }
}

/** Simulate a client calling the agency's number (sandbox only). */
export async function simulateInboundCall(scope: Scope, input: { from: string; scriptId: string }) {
  await requireFeature(scope.tenantId, 'calling');
  const t = await telephony(scope);
  if (!t?.sandbox) throw new UserError('The call simulator only works with the calling sandbox');
  const from = normalizePhone(input.from, scope.country);
  if (!from || from.replace(/\D/g, '').length < 8) throw new UserError('Enter a phone number, e.g. +91 98765 43210');
  const providerCallId = `CA_SBX${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await postSandbox(scope, t, 'inbound', undefined, { kind: 'incoming', providerCallId, from, to: '+910000000000' });
  const call = await inTenant(scope, (tx) => tx.call.findUnique({ where: { providerCallId }, include: { lead: true, client: true } }));
  if (!call) throw new UserError('The call was not recorded');
  const names = await sandboxNames(scope, call.agentId, (call.client ?? call.lead)?.firstName ?? 'there');
  after(() => playSandboxCall(scope, t, call.id, providerCallId, input.scriptId, names));
  return call.id;
}
