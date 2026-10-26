import 'server-only';
import { z } from 'zod';
import { spokenCountry } from '@/lib/countries';
import type { Segment } from '@/integrations/stt/port';
import { runStructured } from './run';

// Post-call notes: summary, next steps, suggested tasks and lead fields from a transcript.

const COUNTRY_CODES = ['CA', 'AU', 'GB', 'US', 'NZ', 'DE', 'IE', 'FR', 'SG', 'AE', 'EU'] as const;

export const callNotesSchema = z.object({
  summary: z.string().min(1).describe('2 to 4 plain sentences: what the caller wanted, key facts, what was agreed'),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  intent: z.enum(['new_enquiry', 'case_update', 'payment', 'complaint', 'other']),
  nextSteps: z.array(z.string()).max(5).describe('Concrete follow-ups the agency promised or should do'),
  tasks: z
    .array(z.object({ title: z.string().max(120), dueInDays: z.number().int().min(0).max(60) }))
    .max(4)
    .describe('Tasks to create for the counsellor, short imperative titles'),
  fields: z
    .object({
      interestCountry: z.enum(COUNTRY_CODES).nullable().describe('Destination country code, if mentioned'),
      interestCategory: z.enum(['STUDY', 'PR', 'WORK', 'VISIT', 'FAMILY']).nullable(),
      intake: z.string().nullable().describe('e.g. "Sep 2027"'),
      englishTest: z.string().nullable().describe('e.g. "IELTS 7.0" or "PTE 79"'),
      budget: z.string().nullable(),
      occupation: z.string().nullable(),
      age: z.number().int().min(10).max(90).nullable(),
    })
    .describe('Facts the caller stated. null when not mentioned. Never guess.'),
});

export type CallNotes = z.infer<typeof callNotesSchema>;

const SYSTEM = `You write call notes for counsellors at a visa and immigration consultancy.
Be factual and brief. Only record facts that were actually said on the call; use null otherwise.
Do not give immigration advice or judge eligibility. Plain English, no marketing tone.`;

const fmt = (segments: Segment[]) =>
  segments.map((s) => `[${Math.floor(s.start / 60)}:${String(Math.floor(s.start % 60)).padStart(2, '0')}] ${s.speaker}: ${s.text}`).join('\n');

export async function callNotes(tenantId: string, segments: Segment[], context: { contactName: string; direction: 'INBOUND' | 'OUTBOUND' }) {
  return runStructured({
    tenantId,
    task: 'call_notes',
    tier: 'smart',
    system: SYSTEM,
    schema: callNotesSchema,
    prompt: `${context.direction === 'INBOUND' ? 'Incoming' : 'Outgoing'} call with ${context.contactName}.\n\nTranscript:\n${fmt(segments)}`,
    fallback: () => heuristicNotes(segments),
  });
}

// ── Sandbox fallback: keyword rules, good enough to exercise the whole flow ──

const COUNTRY_WORDS: [RegExp, (typeof COUNTRY_CODES)[number]][] = [
  [/\bcanad/i, 'CA'], [/\baustrali|\b189\b|\b190\b/i, 'AU'], [/\b(uk|united kingdom|britain|england)\b/i, 'GB'],
  [/\b(usa|united states|america)\b/i, 'US'], [/new zealand/i, 'NZ'], [/german/i, 'DE'], [/ireland/i, 'IE'],
];

export const detectCountry = (text: string) => COUNTRY_WORDS.find(([re]) => re.test(text))?.[1] ?? null;

export const detectCategory = (text: string) =>
  /\b(study|studies|course|college|university|diploma|masters|intake)\b/i.test(text)
    ? ('STUDY' as const)
    : /\b(pr|permanent residen\w*|skilled|points|express entry|189|190|491)\b/i.test(text)
      ? ('PR' as const)
      : /\bwork permit|job offer|work visa\b/i.test(text)
        ? ('WORK' as const)
        : /\b(visit|tourist)\b/i.test(text)
          ? ('VISIT' as const)
          : /\b(spouse|dependant|dependent|family visa|parents)\b/i.test(text)
            ? ('FAMILY' as const)
            : null;

export function heuristicNotes(segments: Segment[]): CallNotes {
  const all = segments.map((s) => s.text).join(' ');
  const said = segments.filter((s) => s.speaker !== 'agent').map((s) => s.text).join(' ') || all;
  // The caller's own words first: the agent's questions mention every option ("study, work, PR…").
  const country = detectCountry(said) ?? detectCountry(all);
  const category = detectCategory(said) ?? detectCategory(all);
  const test = said.match(/\b(IELTS|PTE|TOEFL|Duolingo)\b[^.]*?(\d{1,3}(?:\.\d)?)/i) ?? said.match(/(\d\.\d) overall/i);
  const englishTest = test ? (test.length > 2 ? `${test[1]!.toUpperCase()} ${test[2]}` : `IELTS ${test[1]}`) : null;
  const intake = all.match(/\b(jan(?:uary)?|may|sep(?:tember)?|fall|winter)\w*\s+(20\d\d)/i);
  const budget = said.match(/(\d+(?:\.\d+)?\s*(?:lakh|lakhs|crore|k)\b)/i)?.[1] ?? null;
  const age = Number(said.match(/\bI'?m (\d{2})\b/i)?.[1]) || null;
  const occupation = said.match(/\b(?:a|an) ([a-z ]*(?:engineer|developer|nurse|accountant|teacher|chef|manager))\b/i)?.[1] ?? null;
  const negative = /\b(not happy|unhappy|complain|frustrat|angry|disappoint)\w*/i.test(said);
  const payment = /\b(instal?lment|payment|fees?|invoice)\b/i.test(all);

  const steps: string[] = [];
  if (/checklist|document list/i.test(all)) steps.push('Send the document checklist');
  if (/shortlist/i.test(all)) steps.push('Shortlist colleges');
  if (/fee schedule|fees/i.test(all)) steps.push('Email the fee schedule');
  if (/written update|status in writing|update on whatsapp/i.test(all)) steps.push('Send a written case update on WhatsApp');
  if (/payment link/i.test(all)) steps.push('Send a payment link');
  if (/call (you )?back|monday|saturday|meet/i.test(all)) steps.push('Follow up as agreed on the call');
  if (/skills assessment|acs\b/i.test(all)) steps.push('Start the skills assessment');

  const fields = { interestCountry: country, interestCategory: category, intake: intake?.[0] ?? null, englishTest, budget, occupation, age };

  // They declined: say so plainly (and why, if they said), with nothing to follow up.
  if (/\b(not interested|no longer interested|don'?t (call|contact) me|already (joined|chose|signed up with|applied through|going with) another)\b/i.test(said)) {
    const why = said.match(/\b(already (?:joined|chose|signed up with|applied through|going with) another [a-z]+|found another [a-z]+|plans? (?:have )?changed|can'?t afford[^.]*)/i)?.[1];
    return {
      summary: `Not interested${why ? `: ${why.charAt(0).toLowerCase()}${why.slice(1)}` : ''}. No follow-up needed.`,
      sentiment: 'neutral',
      intent: 'other',
      nextSteps: [],
      tasks: [],
      fields,
    };
  }

  const what = category === 'STUDY' ? 'studying' : category === 'PR' ? 'permanent residency' : category === 'WORK' ? 'a work visa' : 'their visa';
  const where = country ? ` in ${spokenCountry(country)}` : '';
  const facts = [englishTest && `${englishTest}`, intake && `intake ${intake[0]}`, budget && `budget ${budget}`, occupation, age && `age ${age}`].filter(Boolean);
  const summary = negative
    ? `The client was unhappy about a lack of updates on their file${payment ? ' and discussed an overdue payment' : ''}. ${steps.length ? `Agreed: ${steps.join(', ').toLowerCase()}.` : ''}`.trim()
    : !category && !country && !facts.length && !steps.length
      ? 'Short call. No visa details were discussed.'
      : `Discussed ${what}${where}.${facts.length ? ` Mentioned ${facts.join(', ')}.` : ''}${steps.length ? ` Agreed: ${steps.join(', ').toLowerCase()}.` : ''}`;

  return {
    summary,
    sentiment: negative ? 'negative' : 'positive',
    intent: negative ? 'complaint' : payment && !category ? 'payment' : category ? 'new_enquiry' : 'other',
    nextSteps: steps.slice(0, 5),
    tasks: steps.slice(0, 3).map((title, i) => ({ title, dueInDays: i === 0 ? 0 : 2 })),
    fields,
  };
}
