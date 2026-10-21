import 'server-only';
import { fmtDateTime, fullName } from '@/lib/format';
import { db, type Ctx } from '@/lib/tenant';
import { contactKey, getThread, staffNames } from './messages';
import { scopeOf } from './scope';
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
  const botState = creds && bot.mode !== 'off' ? await assistantState(scopeOf(ctx), contact) : null;
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
