import { describe, expect, it } from 'vitest';
import type { Ctx } from '@/lib/tenant';
import { agentStatus, briefAudience, getBrief } from '../copilot';
import { MAX_CARDS, pickSignals, templateBrief, templateHeadline, writeBrief, type Signal } from './brief';

const sig = (id: string, over: Partial<Signal> = {}): Signal => ({
  id,
  kind: 'risk',
  tag: 'Expiry',
  facts: `facts ${id}`,
  line: `line ${id}`,
  quick: false,
  action: { label: 'Open', href: `/x/${id}` },
  rank: 20,
  ...over,
});

describe('copilot brief (template)', () => {
  it('orders by urgency and keeps at most four cards', () => {
    const picked = pickSignals([sig('a', { rank: 50 }), sig('b', { rank: 10 }), sig('c', { rank: 30 }), sig('d', { rank: 15 }), sig('e', { rank: 40 })]);
    expect(picked.map((s) => s.id)).toEqual(['b', 'd', 'c', 'e']);
    expect(picked).toHaveLength(MAX_CARDS);
  });

  it('headline counts risks and says how many are fixable today', () => {
    expect(templateHeadline([])).toBe('Nothing at risk today. A good day to follow up new leads.');
    expect(templateHeadline([sig('a', { quick: true }), sig('b'), sig('c')])).toBe('Three things need attention. One is fixable today.');
    expect(templateHeadline([sig('a', { quick: true }), sig('b', { quick: true })])).toBe('Two things need attention. All are fixable today.');
    expect(templateHeadline([sig('a')])).toBe('One thing needs attention.');
    expect(templateHeadline([sig('o', { kind: 'opportunity' })])).toBe('Nothing at risk today. One opportunity worth a look.');
  });

  it('cards carry the action but not the internal facts', () => {
    const b = templateBrief([sig('a')]);
    expect(b.cards[0]).toEqual({ id: 'a', kind: 'risk', tag: 'Expiry', line: 'line a', action: { label: 'Open', href: '/x/a' } });
  });

  it.skipIf(Boolean(process.env.ANTHROPIC_API_KEY))('without a model, the brief uses the template wording', async () => {
    const b = await writeBrief('t1', [sig('a', { quick: true }), sig('b', { rank: 5 })], 'Thursday');
    expect(b.sandbox).toBe(true);
    expect(b.cards.map((c) => c.line)).toEqual(['line b', 'line a']);
  });
});

// Plan and role gating, without touching the database.
const ctx = (plan: string, role: Ctx['role'], status = 'active', settings: Record<string, unknown> = {}) =>
  ({
    tenant: { id: 't1', slug: 'acme', timezone: 'Asia/Kolkata', settings },
    role,
    access: 'full',
    subscription: { plan, status, seats: 3 },
  }) as unknown as Ctx;

describe('who sees the AI surfaces', () => {
  it('Starter has no copilot and no AI agents', async () => {
    expect(await getBrief(ctx('starter', 'OWNER'))).toBeNull();
    expect(await agentStatus(ctx('starter', 'OWNER'))).toBeNull();
  });

  it('Growth shows only the agents Growth includes', async () => {
    const rows = await agentStatus(ctx('growth', 'COUNSELLOR', 'active', { assistant: { mode: 'off' }, calling: { record: true, aiNotes: false } }));
    expect(rows?.map((r) => `${r.label} · ${r.text}`)).toEqual(['WhatsApp · off', 'Call notes · off']);
    // Staff can't change settings, so the rows link to the work instead.
    expect(rows?.map((r) => r.href)).toEqual(['/acme/inbox', '/acme/calls']);
  });

  it('brief cards follow the role, and document checks follow the plan', () => {
    expect(briefAudience(ctx('pro', 'ACCOUNTS'))).toEqual({ cases: false, billing: true, leads: false, docChecks: true });
    expect(briefAudience(ctx('pro', 'DOC_OFFICER'))).toEqual({ cases: true, billing: false, leads: false, docChecks: true });
    expect(briefAudience(ctx('growth', 'COUNSELLOR'))).toEqual({ cases: true, billing: true, leads: true, docChecks: false });
    expect(briefAudience(ctx('pro', 'OWNER', 'active', { ai: { docChecks: false } })).docChecks).toBe(false);
  });

  it('a trial gets everything', async () => {
    const rows = await agentStatus(ctx('starter', 'OWNER', 'trialing', { assistant: { mode: 'off' }, calling: { record: true, aiNotes: true }, ai: { docChecks: false } }));
    expect(rows?.map((r) => r.key)).toEqual(['voice', 'whatsapp', 'notes', 'docs']);
  });
});
