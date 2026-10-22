import 'server-only';
import { z } from 'zod';
import { runStructured } from './run';

// The copilot's daily brief. Plain code finds what needs attention (signals);
// the model only words the headline and one line per card. Without a model, or
// without credits, the same cards come with template wording.

export type Signal = {
  /** Stable id, so a brief is re-written only when the set of signals changes. */
  id: string;
  kind: 'risk' | 'opportunity';
  tag: string; // short label: "Doc mismatch", "Expiry"…
  /** The facts, for the model and for the template line. */
  facts: string;
  /** Template line, used when there's no model. */
  line: string;
  /** How soon it can be fixed: shown as "fixable today" in the headline. */
  quick: boolean;
  action: { label: string; href: string };
  rank: number; // lower = more urgent
};

export type Card = Omit<Signal, 'facts' | 'rank' | 'quick'>;
export type Brief = { headline: string; cards: Card[]; mode: 'ai' | 'sandbox' | 'basic'; note?: string };

export const MAX_CARDS = 4;

const WORDS = ['No', 'One', 'Two', 'Three', 'Four'];
const say = (n: number) => WORDS[n] ?? String(n);

export function pickSignals(signals: Signal[]) {
  return [...signals].sort((a, b) => a.rank - b.rank).slice(0, MAX_CARDS);
}

export function templateHeadline(picked: Signal[]) {
  const risks = picked.filter((s) => s.kind === 'risk');
  const opps = picked.length - risks.length;
  if (!picked.length) return 'Nothing at risk today. A good day to follow up new leads.';
  if (!risks.length) return `Nothing at risk today. ${say(opps)} ${opps === 1 ? 'opportunity' : 'opportunities'} worth a look.`;
  const quick = risks.filter((s) => s.quick).length;
  const head = `${say(risks.length)} ${risks.length === 1 ? 'thing needs' : 'things need'} attention.`;
  return quick ? `${head} ${quick === risks.length && quick > 1 ? 'All are' : quick === 1 ? 'One is' : `${say(quick)} are`} fixable today.` : head;
}

export function templateBrief(signals: Signal[]): Omit<Brief, 'mode'> {
  const picked = pickSignals(signals);
  return { headline: templateHeadline(picked), cards: picked.map(toCard) };
}

const toCard = (s: Signal): Card => ({ id: s.id, kind: s.kind, tag: s.tag, line: s.line, action: s.action });

const briefSchema = z.object({
  headline: z.string().min(1).max(140).describe('One or two short sentences for the top of the brief, e.g. "Three cases are at risk this week. One is fixable before lunch."'),
  lines: z
    .array(z.object({ n: z.number().int().min(1).max(MAX_CARDS), text: z.string().min(1).max(260) }))
    .describe('One line per numbered item: what is wrong and the next step, under 35 words. Keep every number.'),
});

const SYSTEM = `You write the morning brief for staff at a visa and immigration consultancy.
You get numbered items that plain code has already found. For each, write one plain line: what is wrong (or the opportunity) and the next step.
Rules:
- Use only the facts given. Never invent names, dates, amounts, rules or outcomes.
- No immigration advice or predictions about decisions. Say "check", "ask", "confirm".
- Short sentences, no emoji, no exclamation marks.`;

/** The model words the brief; plain code chose and ordered the cards. */
export async function writeBrief(tenantId: string, signals: Signal[], today: string) {
  const picked = pickSignals(signals);
  const fallback = templateBrief(signals);
  if (!picked.length) return { ...fallback, sandbox: true };
  const res = await runStructured({
    tenantId,
    task: 'copilot_brief',
    tier: 'fast',
    maxTokens: 700,
    system: SYSTEM,
    prompt: `Today is ${today}.\n\n${picked.map((s, i) => `${i + 1}. [${s.kind === 'risk' ? 'RISK' : 'OPPORTUNITY'} · ${s.tag}] ${s.facts}`).join('\n')}`,
    schema: briefSchema,
    fallback: () => ({ headline: fallback.headline, lines: picked.map((s, i) => ({ n: i + 1, text: s.line })) }),
  });
  const byN = new Map(res.data.lines.map((l) => [l.n, l.text]));
  return {
    headline: res.data.headline,
    cards: picked.map((s, i) => ({ ...toCard(s), line: byN.get(i + 1) ?? s.line })),
    sandbox: res.sandbox,
  };
}
