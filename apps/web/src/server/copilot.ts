import 'server-only';
import { createHash } from 'node:crypto';
import { unstable_cache } from 'next/cache';
import { llmFor } from '@/integrations/core/platform';
import { connectionSummary } from '@/integrations/core/connections';
import { CREDIT_COST, hasFeature, type Feature } from '@/lib/plans';
import { can } from '@/lib/permissions';
import { dayBounds, fmtDate, fullName, relative } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { db, type Ctx } from '@/lib/tenant';
import { templateBrief, writeBrief, type Brief, type Signal } from './ai/brief';
import { callingSettings } from './calls/service';
import { docChecksOn } from './doc-checks';
import { consumeCredits, creditSummary } from './plan';
import { stagesOf } from './cases';
import { assistantSettings, officeOpen } from './whatsapp/assistant';

// AI surfaces on the staff dashboard and shell: the copilot's daily brief, what's
// live right now, and the status of each AI agent. Every one of them follows the
// workspace's plan (Starter has no AI) and the viewer's role.

const DAY = 86400_000;

const on = (ctx: Ctx, f: Feature) => Boolean(ctx.subscription && hasFeature(ctx.subscription, f));

/** What this viewer may see in the brief. Cards are agency-wide, filtered by role like the dashboard. */
export function briefAudience(ctx: Ctx) {
  return {
    cases: can(ctx.role, 'case.write'),
    billing: can(ctx.role, 'billing.read'),
    leads: can(ctx.role, 'lead.write'),
    docChecks: on(ctx, 'doc_checks') && docChecksOn(ctx.tenant.settings),
  };
}

export async function gatherSignals(ctx: Ctx, now = new Date()): Promise<Signal[]> {
  const a = briefAudience(ctx);
  const slug = ctx.tenant.slug;
  const tz = ctx.tenant.timezone;
  const today = dayBounds(tz);
  const caseHref = (id: string) => `/${slug}/cases/${id}`;
  const thread = (kind: 'client' | 'lead', id: string) => `/${slug}/inbox?c=${kind}:${id}`;

  return db(ctx, async (tx) => {
    const [checked, expiring, handoffLeads, handoffClients, overdue, stuck, warm] = await Promise.all([
      a.cases && a.docChecks
        ? tx.documentFile.findMany({
            where: { aiStatus: 'done', document: { status: 'UPLOADED', case: { status: { not: 'CLOSED' } } } },
            orderBy: { createdAt: 'desc' },
            take: 40,
            include: { document: { include: { client: true, case: true, files: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true } } } } },
          })
        : [],
      a.cases
        ? tx.document.findMany({
            where: { status: 'VERIFIED', expiresAt: { gte: today.start, lte: new Date(now.getTime() + 183 * DAY) }, case: { status: { not: 'CLOSED' } } },
            orderBy: { expiresAt: 'asc' },
            take: 20,
            include: { client: true, case: { include: { product: true } } },
          })
        : [],
      a.leads ? tx.lead.findMany({ where: { aiHandoffAt: { gte: new Date(now.getTime() - 3 * DAY) } }, take: 10 }) : [],
      a.leads || a.cases ? tx.client.findMany({ where: { aiHandoffAt: { gte: new Date(now.getTime() - 3 * DAY) } }, take: 10 }) : [],
      a.billing
        ? tx.installment.findMany({
            where: { dueDate: { lt: today.start }, invoice: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] } } },
            include: { invoice: { include: { client: true } } },
          })
        : [],
      a.cases
        ? tx.case.findMany({ where: { status: 'OPEN', stageSince: { lt: new Date(now.getTime() - 21 * DAY) } }, orderBy: { stageSince: 'asc' }, take: 20, include: { client: true, product: true } })
        : [],
      a.leads
        ? tx.lead.findMany({
            where: {
              status: { in: ['CONTACTED', 'QUALIFIED'] },
              createdAt: { gte: new Date(now.getTime() - 7 * DAY) },
              OR: [{ score: { gte: 60 } }, { status: 'QUALIFIED' }],
              appointments: { none: { startsAt: { gte: now }, status: 'SCHEDULED' } },
            },
            orderBy: [{ score: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
            take: 10,
          })
        : [],
    ]);

    // Has staff replied since the assistant handed over?
    const handoffs = [
      ...handoffLeads.map((r) => ({ kind: 'lead' as const, row: r })),
      ...handoffClients.map((r) => ({ kind: 'client' as const, row: r })),
    ];
    const waiting = (
      await Promise.all(
        handoffs.map(async (h) => {
          const replied = await tx.message.count({
            where: { [h.kind === 'lead' ? 'leadId' : 'clientId']: h.row.id, direction: 'OUTBOUND', aiGenerated: false, authorId: { not: null }, createdAt: { gt: h.row.aiHandoffAt! } },
          });
          return replied ? null : h;
        }),
      )
    ).filter((h) => h !== null);

    const out: Signal[] = [];

    // Documents the AI check flagged, on the newest upload only.
    const seen = new Set<string>();
    for (const f of checked) {
      if (seen.has(f.documentId) || f.document.files[0]?.id !== f.id) continue;
      seen.add(f.documentId);
      const issue = ((f.aiCheck as { issues?: { severity: string; message: string }[] } | null)?.issues ?? []).find((i) => i.severity === 'high');
      if (!issue) continue;
      const d = f.document;
      const who = fullName(d.client);
      out.push({
        id: `doc:${f.id}`,
        kind: 'risk',
        tag: /match/i.test(issue.message) ? 'Doc mismatch' : 'Document issue',
        facts: `${who} (case ${d.case.ref}), uploaded "${d.name}": ${issue.message}`,
        line: `${d.client.firstName}'s ${d.name}: ${issue.message} Check it before verifying.`,
        quick: true,
        action: { label: 'Review document', href: caseHref(d.caseId) },
        rank: 10 + out.length,
      });
      if (seen.size >= 3) break;
    }

    for (const h of waiting.slice(0, 2)) {
      const who = fullName(h.row);
      const reason = h.row.aiHandoffReason ?? 'asked for a person';
      out.push({
        id: `handoff:${h.kind}:${h.row.id}:${h.row.aiHandoffAt!.toISOString()}`,
        kind: 'risk',
        tag: 'Waiting on you',
        facts: `The WhatsApp assistant handed ${who} to a human ${relative(h.row.aiHandoffAt!, now)} (${reason}). No one on the team has replied since.`,
        line: `${who} is waiting for a person on WhatsApp (${reason}). Nobody has replied yet.`,
        quick: true,
        action: { label: `Reply to ${h.row.firstName}`, href: thread(h.kind, h.row.id) },
        rank: 15,
      });
    }

    // Passports need 6+ months of validity for most visas; other documents 60 days' notice.
    const soon = expiring.filter((d) => d.expiresAt!.getTime() - now.getTime() <= (/passport/i.test(d.name) ? 183 : 60) * DAY);
    for (const d of soon.slice(0, 2)) {
      const days = Math.max(0, Math.ceil((d.expiresAt!.getTime() - now.getTime()) / DAY));
      const who = fullName(d.client);
      out.push({
        id: `exp:${d.id}:${d.expiresAt!.toISOString().slice(0, 10)}`,
        kind: 'risk',
        tag: 'Expiry',
        facts: `${who} (case ${d.case.ref}, ${d.case.product.name}): verified "${d.name}" expires on ${fmtDate(d.expiresAt!, tz)}, in ${days} days.`,
        line: `${who}'s ${d.name} expires in ${days} days (${fmtDate(d.expiresAt!, tz, { year: undefined })}). Ask for a renewed copy.`,
        quick: false,
        action: { label: `Message ${d.client.firstName}`, href: thread('client', d.clientId) },
        rank: 20 + Math.min(days, 180) / 1000,
      });
    }

    const due = overdue.filter((i) => i.paidAmount < i.amount);
    if (due.length) {
      const total = due.reduce((s, i) => s + i.amount - i.paidAmount, 0);
      const worst = [...due].sort((x, y) => y.amount - y.paidAmount - (x.amount - x.paidAmount))[0]!;
      const late = Math.floor((now.getTime() - worst.dueDate.getTime()) / DAY);
      const who = fullName(worst.invoice.client);
      out.push({
        id: `overdue:${due.map((i) => i.id).sort().join(',')}`,
        kind: 'risk',
        tag: 'Overdue',
        facts: `${due.length} installments are overdue, ${formatMoney(total)} in all. Largest: ${who}, ${formatMoney(worst.amount - worst.paidAmount)}, ${late} days late.`,
        line: `${formatMoney(total)} is overdue across ${due.length} installment${due.length === 1 ? '' : 's'}. ${who} owes the most (${formatMoney(worst.amount - worst.paidAmount)}, ${late} days late).`,
        quick: true,
        action: { label: 'Collect', href: `/${slug}/billing/${worst.invoiceId}` },
        rank: 30,
      });
    }

    if (stuck.length) {
      const c = stuck[0]!;
      const stage = stagesOf(c.product).find((s) => s.key === c.stageKey)?.name ?? c.stageKey;
      const days = Math.floor((now.getTime() - c.stageSince.getTime()) / DAY);
      out.push({
        id: `stuck:${stuck.map((s) => s.id).sort().join(',')}`,
        kind: 'risk',
        tag: 'Stalled',
        facts: `${stuck.length} open case${stuck.length === 1 ? ' has' : 's have'} not moved stage in 3+ weeks. Longest: ${fullName(c.client)} (${c.ref}, ${c.product.name}) at "${stage}" for ${days} days.`,
        line: `${fullName(c.client)} has been at ${stage} for ${days} days${stuck.length > 1 ? `, one of ${stuck.length} stalled cases` : ''}. Check what it's waiting on.`,
        quick: false,
        action: { label: 'Open case', href: caseHref(c.id) },
        rank: 40,
      });
    }

    if (warm.length) {
      const names = warm.slice(0, 3).map((l) => fullName(l));
      out.push({
        id: `warm:${warm.map((l) => l.id).sort().join(',')}`,
        kind: 'opportunity',
        tag: 'Opportunity',
        facts: `${warm.length} warm lead${warm.length === 1 ? '' : 's'} from the last 7 days with no consultation booked: ${names.join(', ')}${warm.length > 3 ? ' and others' : ''}.`,
        line: `${warm.length} warm lead${warm.length === 1 ? '' : 's'} from this week ${warm.length === 1 ? 'has' : 'have'} no consultation booked (${names.join(', ')}${warm.length > 3 ? '…' : ''}).`,
        quick: true,
        action: { label: warm.length === 1 ? `Book ${warm[0]!.firstName}` : 'Book consultations', href: warm.length === 1 ? `/${slug}/leads/${warm[0]!.id}` : `/${slug}/leads?view=table&status=QUALIFIED` },
        rank: 50,
      });
    }
    return out;
  });
}

/**
 * The brief for this viewer, or null when the plan has no copilot. Written by the
 * model at most once per day per set of signals (cached, 2 credits); otherwise
 * the template wording, which costs nothing.
 */
export async function getBrief(ctx: Ctx): Promise<Brief | null> {
  if (!on(ctx, 'copilot')) return null;
  const signals = await gatherSignals(ctx);
  const basic = (note?: string): Brief => ({ ...templateBrief(signals), mode: 'basic', note });
  if (!signals.length) return basic();
  if (ctx.access !== 'full') return basic('Your workspace is read-only, so the copilot shows the basic brief.');
  if (llmFor('copilot_brief').sandbox) return { ...(await writeBrief(ctx.tenant.id, signals, '')), mode: 'sandbox' };
  if ((await creditSummary(ctx.tenant.id)).remaining < CREDIT_COST.brief) return basic('AI credits are used up for this month, so this is the basic brief.');

  const a = briefAudience(ctx);
  const day = dayBounds(ctx.tenant.timezone).start.toISOString().slice(0, 10);
  const audience = `${a.cases ? 'c' : ''}${a.billing ? 'b' : ''}${a.leads ? 'l' : ''}${a.docChecks ? 'd' : ''}`;
  const hash = createHash('sha256').update(signals.map((s) => s.id).sort().join('|')).digest('hex').slice(0, 16);
  const today = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: ctx.tenant.timezone }).format(new Date());
  const write = unstable_cache(
    async () => {
      // Errors throw, so a failure is never cached.
      if (!(await consumeCredits(ctx.tenant.id, 'brief', { day }))) throw new Error('no credits');
      const b = await writeBrief(ctx.tenant.id, signals, today);
      return { headline: b.headline, cards: b.cards };
    },
    ['copilot-brief', ctx.tenant.id, audience, day, hash],
    { revalidate: DAY / 1000, tags: [`copilot:${ctx.tenant.id}`] },
  );
  try {
    return { ...(await write()), mode: 'ai' };
  } catch (err) {
    console.error('copilot brief', err);
    return basic('The AI brief is unavailable right now, so this is the basic brief.');
  }
}

// ── Live now ────────────────────────────────────────────────────────────────

export async function liveNow(ctx: Ctx, now = new Date()) {
  const calls = on(ctx, 'calling') || on(ctx, 'voice_agent');
  const bot = assistantSettings(ctx.tenant.settings);
  const waAi = on(ctx, 'wa_assistant') && bot.mode !== 'off';
  if (!calls && !waAi) return null;
  const today = dayBounds(ctx.tenant.timezone);
  return db(ctx, async (tx) => {
    const [live, replies, chats, handoffLeads, handoffClients] = await Promise.all([
      calls
        ? tx.call.findMany({
            where: { status: { in: ['RINGING', 'IN_PROGRESS'] }, startedAt: { gte: new Date(now.getTime() - 3 * 3600_000) } },
            orderBy: { startedAt: 'asc' },
            take: 4,
            include: { lead: true, client: true },
          })
        : [],
      waAi ? tx.message.count({ where: { aiGenerated: true, createdAt: { gte: today.start } } }) : 0,
      waAi ? tx.message.groupBy({ by: ['leadId', 'clientId'], where: { aiGenerated: true, createdAt: { gte: today.start } } }).then((g) => g.length) : 0,
      waAi ? tx.lead.count({ where: { aiHandoffAt: { gte: today.start } } }) : 0,
      waAi ? tx.client.count({ where: { aiHandoffAt: { gte: today.start } } }) : 0,
    ]);
    return {
      calls: live.map((c) => ({
        id: c.id,
        ai: c.aiAgent,
        who: c.client ? fullName(c.client) : c.lead ? fullName(c.lead) : c.contactPhone,
        href: c.clientId ? `/${ctx.tenant.slug}/clients/${c.clientId}` : c.leadId ? `/${ctx.tenant.slug}/leads/${c.leadId}` : `/${ctx.tenant.slug}/calls`,
        agentId: c.agentId,
        purpose: c.purpose,
        direction: c.direction,
        since: (c.answeredAt ?? c.startedAt).toISOString(),
      })),
      whatsapp: waAi ? { name: bot.name, replies, chats, handoffs: handoffLeads + handoffClients } : null,
    };
  });
}

// ── AI agents (sidebar) ─────────────────────────────────────────────────────

export type AgentStatus = { key: string; label: string; state: 'live' | 'on' | 'off'; text: string; href: string };

/** One row per AI agent the plan includes; null on plans without AI. */
export async function agentStatus(ctx: Ctx): Promise<AgentStatus[] | null> {
  const s = ctx.tenant.settings;
  const slug = ctx.tenant.slug;
  const admin = can(ctx.role, 'settings.manage');
  const settings = (tab: string, fallback: string) => (admin ? `/${slug}/settings?tab=${tab}` : fallback);
  const rows: Promise<AgentStatus>[] = [];

  if (on(ctx, 'voice_agent')) {
    rows.push(
      (async () => {
        const conn = await connectionSummary(ctx.tenant.id, 'voice_agent');
        const live = conn ? await db(ctx, (tx) => tx.call.count({ where: { aiAgent: true, status: { in: ['RINGING', 'IN_PROGRESS'] }, startedAt: { gte: new Date(Date.now() - 3 * 3600_000) } } })) : 0;
        return { key: 'voice', label: 'Voice', state: live ? 'live' : conn ? 'on' : 'off', text: live ? `${live} live` : conn ? 'on' : 'not set up', href: settings('voice', `/${slug}/calls`) };
      })(),
    );
  }
  if (on(ctx, 'wa_assistant')) {
    rows.push(
      (async () => {
        const bot = assistantSettings(s);
        const conn = bot.mode !== 'off' ? await connectionSummary(ctx.tenant.id, 'messaging') : null;
        const text = !conn ? 'off' : bot.mode === 'after_hours' && officeOpen(bot, ctx.tenant.timezone) ? 'after hours' : 'on';
        return { key: 'whatsapp', label: 'WhatsApp', state: conn && text === 'on' ? 'on' : 'off', text, href: settings('assistant', `/${slug}/inbox`) };
      })(),
    );
  }
  if (on(ctx, 'call_notes')) {
    const enabled = callingSettings(s).aiNotes;
    rows.push(Promise.resolve({ key: 'notes', label: 'Call notes', state: enabled ? 'on' : 'off', text: enabled ? 'on' : 'off', href: settings('calling', `/${slug}/calls`) }));
  }
  if (on(ctx, 'doc_checks')) {
    rows.push(
      (async () => {
        if (!docChecksOn(s)) return { key: 'docs', label: 'Doc check', state: 'off' as const, text: 'off', href: settings('integrations', `/${slug}/documents`) };
        const pending = await db(ctx, (tx) => tx.documentFile.count({ where: { aiStatus: 'pending', createdAt: { gte: new Date(Date.now() - 3600_000) } } }));
        return { key: 'docs', label: 'Doc check', state: pending ? 'live' : 'on', text: pending ? `checking ${pending}` : 'on', href: `/${slug}/documents` };
      })(),
    );
  }
  return rows.length ? Promise.all(rows) : null;
}
