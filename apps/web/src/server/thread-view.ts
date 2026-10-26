import 'server-only';
import { CATEGORY_LABEL, LEAD_SOURCE_LABEL, LEAD_STATUS_LABEL } from '@/lib/constants';
import { countryName } from '@/lib/countries';
import { fmtDate, fmtDateTime, fullName } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { can } from '@/lib/permissions';
import { hasFeature } from '@/lib/plans';
import { db, type Ctx } from '@/lib/tenant';
import { contactKey, getThread, staffNames } from './messages';
import { scopeOf } from './scope';
import { stagesOf } from './cases';
import { assistantSettings, assistantState, describeAssistant } from './whatsapp/assistant';
import { messagingStatus, windowClosesAt, windowOpen, type Contact } from './whatsapp/service';

// Everything the conversation UI needs for one contact, in serialisable form.

export type ThreadView = Awaited<ReturnType<typeof buildThread>>;

export async function buildThread(ctx: Ctx, contact: Contact) {
  const tz = ctx.tenant.timezone;
  const [messages, who, templates, saveTargets] = await Promise.all([
    getThread(ctx, contact),
    db(ctx, async (tx) => {
      const r =
        contact.kind === 'client'
          ? await tx.client.findUnique({ where: { id: contact.id } })
          : await tx.lead.findUnique({ where: { id: contact.id } });
      return r
        ? { firstName: r.firstName, lastName: r.lastName, ref: r.ref, phoneNormalized: r.phoneNormalized, waLastInbound: r.waLastInbound, waOptIn: r.waOptIn, aiHandoffAt: r.aiHandoffAt, aiHandoffReason: r.aiHandoffReason }
        : null;
    }),
    db(ctx, (tx) => tx.whatsAppTemplate.findMany({ where: { status: 'APPROVED' }, orderBy: { name: 'asc' } })),
    contact.kind === 'client'
      ? db(ctx, (tx) =>
          tx.document.findMany({
            where: { clientId: contact.id, status: { in: ['PENDING', 'REJECTED', 'UPLOADED'] }, case: { status: { not: 'CLOSED' } } },
            include: { case: true },
            orderBy: [{ caseId: 'asc' }, { sortOrder: 'asc' }],
          }),
        )
      : Promise.resolve([]),
  ]);
  if (!who) return null;
  const names = await staffNames(messages.map((m) => m.authorId));
  const name = fullName(who);
  const creds = await messagingStatus({ tenantId: ctx.tenant.id, slug: ctx.tenant.slug });
  const open = windowOpen(who.waLastInbound);
  const bot = assistantSettings(ctx.tenant.settings);
  // The assistant only runs on plans that include it (a lapsed trial keeps its settings).
  const botOn = Boolean(ctx.subscription && hasFeature(ctx.subscription, 'wa_assistant'));
  const botState = creds && botOn && bot.mode !== 'off' ? await assistantState(scopeOf(ctx), contact) : null;
  const closes = windowClosesAt(who.waLastInbound);

  return {
    key: contactKey(contact),
    kind: contact.kind,
    id: contact.id,
    name,
    firstName: who.firstName,
    ref: who.ref,
    phone: who.phoneNormalized,
    href: `/${ctx.tenant.slug}/${contact.kind === 'client' ? 'clients' : 'leads'}/${contact.id}`,
    unread: messages.filter((m) => m.direction === 'INBOUND' && !m.readAt).length,
    portal: contact.kind === 'client',
    whatsapp:
      creds && who.phoneNormalized
        ? {
            mode: creds.sandbox ? ('sandbox' as const) : ('live' as const),
            windowOpen: open,
            closes: open && closes ? fmtDateTime(closes, tz) : null,
            optIn: who.waOptIn,
            templates: templates.map((t) => ({ value: `${t.name}|${t.language}`, name: t.name, body: t.body, variables: t.variables, category: t.category })),
          }
        : null,
    assistant: botState ? { name: bot.name, status: botState.status, text: describeAssistant(bot.name, botState, tz) } : null,
    saveTargets: saveTargets.map((d) => ({ id: d.id, label: `${d.case.ref} · ${d.name}` })),
    messages: messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      channel: m.channel,
      body: m.body,
      author: m.direction === 'INBOUND' ? name : m.aiGenerated ? `${bot.name} · AI assistant` : m.authorId ? (names[m.authorId] ?? 'Agency') : m.channel === 'WHATSAPP' ? 'Automation' : 'Agency',
      ai: m.aiGenerated,
      at: fmtDateTime(m.createdAt, tz),
      status: m.status,
      error: m.error,
      template: m.templateName,
      media: m.mediaType ? { type: m.mediaType, name: m.mediaName, available: Boolean(m.mediaKey) } : null,
      readByClient: m.channel === 'PORTAL' && m.direction === 'OUTBOUND' && Boolean(m.readAt),
    })),
  };
}

// ── Context panel beside the conversation ───────────────────────────────────

const AI_NOTE = /^From (?:WhatsApp (AI assistant)|AI voice call):s*/;

export type ContactContext = Awaited<ReturnType<typeof buildContactContext>>;

/** Who this is, where they are, and what the AI picked up. AI-only parts follow the plan. */
export async function buildContactContext(ctx: Ctx, contact: Contact) {
  const slug = ctx.tenant.slug;
  const tz = ctx.tenant.timezone;
  const sub = ctx.subscription;
  const eligibilityOn = Boolean(sub && hasFeature(sub, 'eligibility'));
  const billing = can(ctx.role, 'billing.read');
  const link = contact.kind === 'client' ? { clientId: contact.id } : { leadId: contact.id };

  return db(ctx, async (tx) => {
    const [lead, client, notes, appointment] = await Promise.all([
      contact.kind === 'lead' ? tx.lead.findUnique({ where: { id: contact.id } }) : null,
      contact.kind === 'client'
        ? tx.client.findUnique({
            where: { id: contact.id },
            include: {
              cases: { where: { status: { not: 'CLOSED' } }, include: { product: true }, orderBy: { createdAt: 'desc' }, take: 3 },
              invoices: billing ? { where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] } }, select: { total: true, amountPaid: true, currency: true } } : false,
              eligibility: eligibilityOn ? { orderBy: { createdAt: 'desc' }, take: 1 } : false,
            },
          })
        : null,
      tx.note.findMany({ where: { ...link, OR: [{ body: { startsWith: 'From WhatsApp (AI assistant):' } }, { body: { startsWith: 'From AI voice call:' } }] }, orderBy: { createdAt: 'desc' }, take: 3 }),
      tx.appointment.findFirst({ where: { ...link, status: 'SCHEDULED', startsAt: { gte: new Date() } }, orderBy: { startsAt: 'asc' } }),
    ]);
    const row = lead ?? client;
    if (!row) return null;
    const ownerId = row.ownerId;
    const owner = ownerId ? (await staffNames([ownerId]))[ownerId] ?? null : null;
    const interest = lead ? [lead.interestCountry && (countryName(lead.interestCountry)), lead.interestCategory && CATEGORY_LABEL[lead.interestCategory]].filter(Boolean).join(' · ') : null;
    const due = client && Array.isArray(client.invoices) ? client.invoices.reduce((a, i) => a + i.total - i.amountPaid, 0) : 0;
    const check = client && Array.isArray(client.eligibility) ? client.eligibility[0] : undefined;

    return {
      status: lead ? LEAD_STATUS_LABEL[lead.status] : 'Client',
      source: lead ? LEAD_SOURCE_LABEL[lead.source] : null,
      owner,
      interest: interest || null,
      score: lead?.score ?? null,
      cases: (client?.cases ?? []).map((c) => ({
        id: c.id,
        ref: c.ref,
        product: c.product.name,
        stage: stagesOf(c).find((s) => s.key === c.stageKey)?.name ?? c.stageKey,
        href: `/${slug}/cases/${c.id}`,
      })),
      nextAppointment: appointment ? `${fmtDateTime(appointment.startsAt, tz)} · ${appointment.title}` : null,
      amountDue: billing && due > 0 ? formatMoney(due) : null,
      eligibility: check ? { label: check.kind === 'CRS' ? 'CRS score' : 'AU points', score: check.score, at: fmtDate(check.createdAt, tz, { year: undefined }) } : null,
      captured: notes.map((n) => ({ id: n.id, text: n.body.replace(AI_NOTE, '').trim(), at: fmtDate(n.createdAt, tz, { year: undefined }), via: n.body.startsWith('From AI voice call') ? 'Voice agent call' : 'WhatsApp assistant' })),
    };
  });
}
