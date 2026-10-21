import 'server-only';
import { prisma, type Prisma, type Tx } from '@kicko/db';
import type { TenantSettings } from '@kicko/db/provision';
import { z } from 'zod';
import { CATEGORY_LABEL, COUNTRIES } from '@/lib/constants';
import { fmtDateTime, fullName, toLocalInput } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { assistantTurn, type AssistantInput, type AssistantTurn } from '../ai/assistant';
import { bookingStaff, bookSlot, openSlots } from '../booking';
import { stagesOf } from '../cases';
import type { Contact } from '../contacts';
import { inTenant, logActivity, UserError, type Scope } from '../scope';
import { sendText } from './service';

// WhatsApp AI assistant: answers inbound messages from the agency's knowledge base
// and the customer's own record, books consultations, saves what they tell us, and
// hands off to a human when it should. Staff replying pauses it for that contact.

export const DEFAULT_ASSISTANT: NonNullable<TenantSettings['assistant']> = {
  mode: 'off',
  name: 'Asha',
  days: [1, 2, 3, 4, 5, 6],
  start: '10:00',
  end: '18:00',
  booking: true,
};
export const assistantSettings = (s: TenantSettings) => ({ ...DEFAULT_ASSISTANT, ...s.assistant });
type Cfg = ReturnType<typeof assistantSettings>;

const DEBOUNCE_MS = Number(process.env.ASSISTANT_DEBOUNCE_MS ?? 1500);
const STAFF_PAUSE_MS = 12 * 3600_000;
const MAX_REPLIES_PER_DAY = 30;
const PLACEHOLDER_NAMES = ['WhatsApp contact', 'Caller'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function officeOpen(cfg: Pick<Cfg, 'days' | 'start' | 'end'>, tz: string, now = new Date()) {
  const local = toLocalInput(now, tz);
  const weekday = new Date(`${local.slice(0, 10)}T12:00:00Z`).getUTCDay();
  const hm = local.slice(11, 16);
  return cfg.days.includes(weekday) && hm >= cfg.start && hm < cfg.end;
}

export const hoursLabel = (cfg: Pick<Cfg, 'days' | 'start' | 'end'>) =>
  `${cfg.days.map((d) => DAY_NAMES[d]).join(', ')} ${cfg.start}–${cfg.end}`;

const link = (c: Contact) => (c.kind === 'client' ? { clientId: c.id } : { leadId: c.id });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadContact(tx: Tx, c: Contact) {
  const row = c.kind === 'client' ? await tx.client.findUnique({ where: { id: c.id } }) : await tx.lead.findUnique({ where: { id: c.id } });
  if (!row) throw new UserError('Contact not found');
  return row;
}

// ── Trigger ─────────────────────────────────────────────────────────────────

export type AssistantState =
  | { status: 'off' }
  | { status: 'office_hours'; closes: string }
  | { status: 'active' }
  | { status: 'handed_off'; reason: string; at: Date }
  | { status: 'paused'; until: Date }
  | { status: 'limit' };

/** Would the assistant answer this contact right now, and if not, why. */
export async function assistantState(scope: Scope, contact: Contact): Promise<AssistantState> {
  const cfg = assistantSettings(scope.settings);
  if (cfg.mode === 'off') return { status: 'off' };
  if (cfg.mode === 'after_hours' && officeOpen(cfg, scope.timezone)) return { status: 'office_hours', closes: cfg.end };
  return inTenant(scope, async (tx): Promise<AssistantState> => {
    const row = await loadContact(tx, contact);
    if (row.aiHandoffAt) return { status: 'handed_off', reason: row.aiHandoffReason ?? 'Handed to a human', at: row.aiHandoffAt };
    // A staff reply pauses it for 12 hours, unless staff resumed it after that reply.
    const since = new Date(Math.max(Date.now() - STAFF_PAUSE_MS, row.aiResumedAt?.getTime() ?? 0));
    const staff = await tx.message.findFirst({
      where: { ...link(contact), direction: 'OUTBOUND', aiGenerated: false, authorId: { not: null }, createdAt: { gt: since } },
      orderBy: { createdAt: 'desc' },
    });
    if (staff) return { status: 'paused', until: new Date(staff.createdAt.getTime() + STAFF_PAUSE_MS) };
    const aiToday = await tx.message.count({ where: { ...link(contact), aiGenerated: true, createdAt: { gt: new Date(Date.now() - 86400_000) } } });
    return aiToday >= MAX_REPLIES_PER_DAY ? { status: 'limit' } : { status: 'active' };
  });
}

/** Plain-English status for the inbox bar and the simulator. */
export function describeAssistant(name: string, s: AssistantState, tz: string): { title: string; detail: string } {
  switch (s.status) {
    case 'off':
      return { title: 'AI assistant is off', detail: 'Turn it on in Settings → AI assistant.' };
    case 'office_hours':
      return { title: `${name} (AI) is resting`, detail: `Office hours: your team replies. It takes over after ${s.closes}.` };
    case 'active':
      return { title: `${name} (AI) is answering this chat`, detail: 'Replying yourself pauses it for 12 hours.' };
    case 'handed_off':
      return { title: 'Handed to a human', detail: `${s.reason} · ${fmtDateTime(s.at, tz)}` };
    case 'paused':
      return { title: `${name} (AI) is paused`, detail: `A team member replied, so it stays quiet until ${fmtDateTime(s.until, tz)}.` };
    case 'limit':
      return { title: `${name} (AI) is paused`, detail: 'It reached today’s reply limit for this chat.' };
  }
}

/** Called (in the background) after every inbound WhatsApp message. Never throws. */
export async function assistOnInbound(scope: Scope, contact: Contact, messageId: string) {
  try {
    const cfg = assistantSettings(scope.settings);
    if ((await assistantState(scope, contact)).status !== 'active') return;
    // Customers often send several short messages: answer once, after the last one.
    await pause(DEBOUNCE_MS);
    const latest = await inTenant(scope, (tx) =>
      tx.message.findFirst({ where: { ...link(contact), channel: 'WHATSAPP', direction: 'INBOUND' }, orderBy: { createdAt: 'desc' } }),
    );
    if (latest?.id !== messageId) return; // a newer message will be answered
    if ((await assistantState(scope, contact)).status !== 'active') return; // staff may have stepped in meanwhile
    await reply(scope, contact, cfg);
  } catch (err) {
    console.error('assistant', err);
  }
}

// ── Context ─────────────────────────────────────────────────────────────────

type Slot = { iso: string; label: string };

async function slotsFor(scope: Scope, cfg: Cfg, ownerId: string | null, previouslyOffered: string[] = []) {
  if (!cfg.booking) return { enabled: false, slots: [] as Slot[] };
  const avail = await openSlots(scope, await bookingStaff(scope, ownerId), 14);
  if (!avail.enabled) return { enabled: false, slots: [] as Slot[] };
  const open = new Set(avail.days.flatMap((d) => d.slots));
  // Keep the numbering the customer saw, as long as those times are still free.
  const kept = previouslyOffered.filter((s) => open.has(s));
  // Otherwise offer a spread: up to two times a day (morning first, then afternoon), six in all.
  const spread = avail.days.flatMap((d) => (d.slots.length > 1 ? [d.slots[0]!, d.slots[Math.floor(d.slots.length / 2)]!] : d.slots)).slice(0, 6);
  const isos = kept.length ? kept : spread;
  return { enabled: true, slots: isos.map((iso) => ({ iso, label: fmtDateTime(iso, scope.timezone) })) };
}

async function buildInput(scope: Scope, cfg: Cfg, contact: Contact) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: scope.tenantId } });
  const data = await inTenant(scope, async (tx) => {
    const row = await loadContact(tx, contact);
    const now = new Date();
    const [cases, appt, invoices, knowledge, messages] = await Promise.all([
      contact.kind === 'client'
        ? tx.case.findMany({
            where: { clientId: contact.id, status: 'OPEN' },
            include: { product: true, documents: { where: { required: true, status: { in: ['PENDING', 'REJECTED'] } }, orderBy: { sortOrder: 'asc' }, take: 5 } },
            take: 3,
          })
        : Promise.resolve([]),
      tx.appointment.findFirst({ where: { ...link(contact), status: 'SCHEDULED', startsAt: { gt: now } }, orderBy: { startsAt: 'asc' } }),
      contact.kind === 'client' ? tx.invoice.findMany({ where: { clientId: contact.id, status: { in: ['ISSUED', 'PARTIALLY_PAID'] } } }) : Promise.resolve([]),
      tx.knowledgeItem.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' }, take: 60 }),
      tx.message.findMany({ where: { ...link(contact), channel: 'WHATSAPP' }, orderBy: { createdAt: 'desc' }, take: 14 }),
    ]);
    return { row, cases, appt, invoices, knowledge, messages: messages.reverse() };
  });

  // Everything the customer sent since our last reply is the new message.
  const lastOut = data.messages.map((m) => m.direction).lastIndexOf('OUTBOUND');
  const pending = data.messages.slice(lastOut + 1).filter((m) => m.direction === 'INBOUND');
  const history = data.messages.slice(0, lastOut + 1).slice(-12);
  const lastAi = [...history].reverse().find((m) => m.aiGenerated);
  const offered = ((lastAi?.aiMeta as { offeredSlots?: string[] } | null)?.offeredSlots ?? []).filter(Boolean);
  const { enabled, slots } = await slotsFor(scope, cfg, data.row.ownerId, offered);
  const due = data.invoices.reduce((a, i) => a + i.total - i.amountPaid, 0);
  const name = fullName(data.row);
  const lead = 'interestCountry' in data.row ? data.row : null;

  const input: AssistantInput = {
    agency: tenant.name,
    assistantName: cfg.name,
    now: fmtDateTime(new Date(), scope.timezone),
    officeHours: hoursLabel(cfg),
    officeOpen: officeOpen(cfg, scope.timezone),
    contact: {
      kind: contact.kind,
      name: PLACEHOLDER_NAMES.includes(name) ? null : name,
      interest: lead ? [lead.interestCategory && CATEGORY_LABEL[lead.interestCategory], lead.interestCountry && (COUNTRIES[lead.interestCountry] ?? lead.interestCountry)].filter(Boolean).join(' · ') || null : null,
      cases: data.cases.map((c) => ({
        product: `${COUNTRIES[c.product.country] ?? c.product.country} ${c.product.name}`,
        stage: stagesOf(c.product).find((s) => s.key === c.stageKey)?.name ?? c.stageKey,
        pendingDocs: c.documents.map((d) => d.name),
      })),
      nextAppointment: data.appt ? fmtDateTime(data.appt.startsAt, scope.timezone) : null,
      amountDue: due > 0 ? formatMoney(due) : null,
    },
    knowledge: data.knowledge.map(({ question, answer }) => ({ question, answer })),
    slots: slots.map((s) => s.label),
    bookingEnabled: enabled,
    history: history.map((m) => ({ from: m.direction === 'INBOUND' ? 'customer' : m.aiGenerated ? 'assistant' : 'staff', text: m.body })),
    firstReply: !data.messages.some((m) => m.aiGenerated && Date.now() - m.createdAt.getTime() < 86400_000),
    message: pending.map((m) => m.body || (m.mediaType ? `[sent a ${m.mediaType}]` : '')).join('\n') || '(empty)',
  };
  return { input, slots, row: data.row };
}

// ── Acting on a turn ────────────────────────────────────────────────────────

async function reply(scope: Scope, contact: Contact, cfg: Cfg) {
  const { input, slots, row } = await buildInput(scope, cfg, contact);
  const result = await assistantTurn(scope.tenantId, input);
  const turn = result.data;
  const actions: string[] = [];
  let text = turn.reply;

  if (turn.capture) {
    const done = await saveCapture(scope, contact, row, turn.capture);
    if (done) actions.push('saved details');
  }

  if (turn.book) {
    const slot = slots[turn.book.slot - 1];
    try {
      if (!slot) throw new UserError('That time is not available');
      await bookSlot(scope, { contact, ownerId: row.ownerId, startsAt: slot.iso, mode: turn.book.mode, topic: 'Booked by the WhatsApp assistant', via: 'WhatsApp assistant' });
      actions.push(`booked ${slot.label}`);
    } catch (err) {
      const fresh = await slotsFor(scope, cfg, row.ownerId);
      text = `Sorry, that time was just taken.${fresh.slots.length ? ` These are free:\n${fresh.slots.map((s, i) => `${i + 1}. ${s.label}`).join('\n')}\nReply with the number that suits you.` : ' A counsellor will arrange a time with you.'}`;
      turn.offerSlots = fresh.slots.length > 0;
      slots.splice(0, slots.length, ...fresh.slots);
      if (!(err instanceof UserError)) console.error('assistant booking', err);
    }
  }

  const handoff = turn.handoff ?? (turn.confidence === 'low' ? { reason: 'Assistant was unsure' } : null);
  if (handoff) {
    await handOff(scope, contact, row, handoff.reason);
    actions.push('handed off');
  }

  const meta: Prisma.InputJsonObject = {
    model: result.model,
    sandbox: result.sandbox,
    confidence: turn.confidence,
    actions,
    ...(turn.offerSlots ? { offeredSlots: slots.map((s) => s.iso) } : {}),
  };
  await sendText(scope, contact, text, { ai: meta });
  return { turn, actions };
}

async function saveCapture(scope: Scope, contact: Contact, row: { firstName: string; lastName: string | null; email: string | null }, c: NonNullable<AssistantTurn['capture']>) {
  const email = c.email && z.email().safeParse(c.email).success ? c.email.toLowerCase() : null;
  return inTenant(scope, async (tx) => {
    let changed = false;
    if (contact.kind === 'lead') {
      const data: Prisma.LeadUpdateInput = {};
      if (c.firstName && PLACEHOLDER_NAMES.includes(fullName(row))) {
        data.firstName = c.firstName.slice(0, 60);
        data.lastName = c.lastName?.slice(0, 60) ?? null;
      }
      if (email && !row.email) data.email = email;
      if (c.interestCountry) data.interestCountry = c.interestCountry;
      if (c.interestCategory) data.interestCategory = c.interestCategory;
      if (Object.keys(data).length) {
        await tx.lead.update({ where: { id: contact.id }, data });
        changed = true;
      }
    } else if (email && !row.email) {
      await tx.client.update({ where: { id: contact.id }, data: { email } });
      changed = true;
    }
    if (c.notes?.trim()) {
      await tx.note.create({ data: { tenantId: scope.tenantId, body: `From WhatsApp (AI assistant): ${c.notes.trim().slice(0, 1000)}`, ...link(contact) } });
      changed = true;
    }
    if (changed) await logActivity(tx, scope, { type: 'WHATSAPP', summary: 'AI assistant saved details from the chat', ...link(contact) });
    return changed;
  });
}

async function handOff(scope: Scope, contact: Contact, row: { firstName: string; lastName: string | null; ownerId: string | null }, reason: string) {
  const assignee = await bookingStaff(scope, row.ownerId);
  await inTenant(scope, async (tx) => {
    const data = { aiHandoffAt: new Date(), aiHandoffReason: reason.slice(0, 200) };
    if (contact.kind === 'client') await tx.client.update({ where: { id: contact.id }, data });
    else await tx.lead.update({ where: { id: contact.id }, data });
    await tx.task.create({
      data: { tenantId: scope.tenantId, title: `Reply on WhatsApp: ${fullName(row)} (${reason.slice(0, 80)})`, dueAt: new Date(), priority: 1, assigneeId: assignee, ...link(contact) },
    });
    await logActivity(tx, scope, { type: 'WHATSAPP', summary: `AI assistant handed the chat to a human: ${reason}`, ...link(contact) });
  });
}

/** Staff "Take over" (pause the assistant for this contact) or "Resume AI". */
export async function setAssistantPaused(scope: Scope, contact: Contact, paused: boolean) {
  await inTenant(scope, async (tx) => {
    // Resuming also overrides the 12-hour pause from earlier staff replies.
    const data = paused
      ? { aiHandoffAt: new Date(), aiHandoffReason: 'A team member took over' }
      : { aiHandoffAt: null, aiHandoffReason: null, aiResumedAt: new Date() };
    if (contact.kind === 'client') await tx.client.update({ where: { id: contact.id }, data });
    else await tx.lead.update({ where: { id: contact.id }, data });
    await logActivity(tx, scope, { type: 'WHATSAPP', summary: paused ? 'Took over the chat from the AI assistant' : 'AI assistant resumed for this chat', ...link(contact) });
  });
}

// ── Playground (Settings): dry run, no side effects ─────────────────────────

export const previewInput = z.object({
  history: z.array(z.object({ from: z.enum(['customer', 'assistant']), text: z.string().max(2000) })).max(20),
  message: z.string().trim().min(1, 'Type a message').max(2000),
});

export async function previewAssistant(scope: Scope, raw: unknown) {
  const { history, message } = previewInput.parse(raw);
  const cfg = assistantSettings(scope.settings);
  const [tenant, knowledge] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: scope.tenantId } }),
    inTenant(scope, (tx) => tx.knowledgeItem.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' }, take: 60 })),
  ]);
  const { enabled, slots } = await slotsFor(scope, cfg, null);
  const input: AssistantInput = {
    agency: tenant.name,
    assistantName: cfg.name,
    now: fmtDateTime(new Date(), scope.timezone),
    officeHours: hoursLabel(cfg),
    officeOpen: officeOpen(cfg, scope.timezone),
    contact: { kind: 'lead', name: null, cases: [], nextAppointment: null, amountDue: null },
    knowledge: knowledge.map(({ question, answer }) => ({ question, answer })),
    slots: slots.map((s) => s.label),
    bookingEnabled: enabled,
    history,
    firstReply: !history.some((h) => h.from === 'assistant'),
    message,
  };
  const r = await assistantTurn(scope.tenantId, input);
  const t = r.data;
  return {
    reply: t.reply,
    sandbox: r.sandbox,
    confidence: t.confidence,
    actions: [
      t.capture && Object.values(t.capture).some(Boolean) && 'Would save details',
      t.book && `Would book ${slots[t.book.slot - 1]?.label ?? 'a slot'}`,
      (t.handoff || t.confidence === 'low') && `Would hand off: ${t.handoff?.reason ?? 'unsure'}`,
    ].filter(Boolean) as string[],
  };
}

// ── Knowledge base ──────────────────────────────────────────────────────────

export const knowledgeInput = z.object({
  question: z.string().trim().min(3, 'Write the question').max(300),
  answer: z.string().trim().min(3, 'Write the answer').max(2000),
});

export async function saveKnowledge(scope: Scope, id: string | null, raw: unknown) {
  const input = knowledgeInput.parse(raw);
  await inTenant(scope, (tx) =>
    id ? tx.knowledgeItem.update({ where: { id }, data: input }) : tx.knowledgeItem.create({ data: { tenantId: scope.tenantId, ...input } }),
  );
}

export async function toggleKnowledge(scope: Scope, id: string, active: boolean) {
  await inTenant(scope, (tx) => tx.knowledgeItem.update({ where: { id }, data: { active } }));
}

export async function deleteKnowledge(scope: Scope, id: string) {
  await inTenant(scope, (tx) => tx.knowledgeItem.delete({ where: { id } }));
}

/** Generic starter answers an agency edits; nothing agency-specific is invented. */
export async function seedStarterKnowledge(scope: Scope) {
  const cfg = assistantSettings(scope.settings);
  const items = [
    { question: 'What are your office hours?', answer: `We're open ${hoursLabel(cfg)}. You can message us here any time.` },
    { question: 'How do I book a consultation?', answer: 'Just ask here on WhatsApp for a consultation and I will share the next free times. You can meet us at the office, or by video or phone.' },
    {
      question: 'What documents do I need for a student visa?',
      answer: 'Usually your passport, academic transcripts and certificates, an English test score (IELTS, PTE or TOEFL), a statement of purpose and proof of funds. Your counsellor will share the exact checklist for your course and country.',
    },
    { question: 'Can you guarantee my visa?', answer: 'No one can guarantee a visa: the decision is made by the immigration authorities. We make sure your application is complete, accurate and well prepared.' },
    { question: 'How long does visa processing take?', answer: 'It depends on the country, visa type and time of year. Your counsellor will tell you the current processing times for your application.' },
  ];
  await inTenant(scope, async (tx) => {
    const existing = new Set((await tx.knowledgeItem.findMany({ select: { question: true } })).map((k) => k.question));
    for (const i of items) if (!existing.has(i.question)) await tx.knowledgeItem.create({ data: { tenantId: scope.tenantId, ...i } });
  });
}
