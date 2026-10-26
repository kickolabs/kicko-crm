import 'server-only';
import { z } from 'zod';
import { spokenCountry } from '@/lib/countries';
import { detectCategory, detectCountry } from './call-notes';
import { runStructured } from './run';

// The WhatsApp assistant's brain: one structured decision per customer message.
// The engine (server/whatsapp/assistant.ts) gathers context and carries out actions.

export const assistantTurnSchema = z.object({
  reply: z.string().min(1).max(1200).describe('The WhatsApp message to send. Short (under 80 words), warm, in the language the customer wrote in.'),
  confidence: z.enum(['high', 'medium', 'low']).describe('low = you could not answer from the facts given; a human will follow up'),
  handoff: z.object({ reason: z.string().max(200) }).nullable().describe('Hand the conversation to a human (complaint, asks for a person, advice needed, or you are unsure)'),
  book: z
    .object({ slot: z.number().int().min(1).max(6), mode: z.enum(['IN_PERSON', 'VIDEO', 'PHONE']) })
    .nullable()
    .describe('Only when the customer clearly chose one of the numbered AVAILABLE SLOTS'),
  offerSlots: z.boolean().describe('true if your reply lists the AVAILABLE SLOTS for the customer to choose from'),
  capture: z
    .object({
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
      email: z.string().nullable(),
      interestCountry: z.enum(['CA', 'AU', 'GB', 'US', 'NZ', 'DE', 'IE', 'FR', 'SG', 'AE', 'EU']).nullable(),
      interestCategory: z.enum(['STUDY', 'PR', 'WORK', 'VISIT', 'FAMILY']).nullable(),
      notes: z.string().nullable().describe('Other facts they told you: course, intake, test scores, budget'),
    })
    .nullable()
    .describe('Details the customer stated in this conversation, to save on their record. null fields when not stated.'),
});

export type AssistantTurn = z.infer<typeof assistantTurnSchema>;

export type AssistantInput = {
  agency: string;
  assistantName: string;
  now: string; // local time, human readable
  officeHours: string;
  officeOpen: boolean;
  contact: {
    kind: 'client' | 'lead';
    name: string | null; // null when we only have a placeholder name
    interest?: string | null;
    cases: { product: string; stage: string; pendingDocs: string[] }[];
    nextAppointment: string | null;
    amountDue: string | null;
  };
  knowledge: { question: string; answer: string }[];
  slots: string[]; // labels, numbered from 1
  bookingEnabled: boolean;
  history: { from: 'customer' | 'assistant' | 'staff'; text: string }[];
  firstReply: boolean;
  message: string;
};

const SYSTEM = `You are the WhatsApp assistant of a visa and immigration consultancy. You help customers on behalf of the agency's counsellors.

Rules:
- Answer ONLY from the AGENCY ANSWERS and the CUSTOMER RECORD below. If the answer isn't there, say a counsellor will reply and set handoff, with confidence "low".
- Never give immigration advice, eligibility opinions, points estimates or visa guarantees. Never invent fees, dates, requirements or processing times.
- Hand off to a human when the customer asks for a person, complains, is upset, wants a refund, or anything is sensitive.
- To book a consultation, list the AVAILABLE SLOTS with their numbers and ask the customer to reply with a number (set offerSlots). Only set "book" when they clearly picked one; confirm the time in your reply.
- Use the customer's name if known. Be brief: this is WhatsApp. No markdown headings; plain text with line breaks.
- Reply in the customer's language (English, Hindi, Tamil, Punjabi…).
- If this is your first reply in the conversation, say you're the agency's virtual assistant.`;

function prompt(i: AssistantInput) {
  const c = i.contact;
  const record = [
    `Type: ${c.kind === 'client' ? 'existing client' : 'new enquiry (lead)'}`,
    `Name: ${c.name ?? 'unknown (ask for it naturally)'}`,
    c.interest && `Interested in: ${c.interest}`,
    ...c.cases.map((k) => `Case: ${k.product}, current stage "${k.stage}"${k.pendingDocs.length ? `, documents still needed: ${k.pendingDocs.join(', ')}` : ''}`),
    c.nextAppointment && `Next appointment: ${c.nextAppointment}`,
    c.amountDue && `Amount due: ${c.amountDue}`,
  ].filter(Boolean);
  return `AGENCY: ${i.agency}. You are "${i.assistantName}".
NOW: ${i.now}. Office hours: ${i.officeHours} (${i.officeOpen ? 'open now' : 'closed now'}).

CUSTOMER RECORD:
${record.join('\n')}

AGENCY ANSWERS:
${i.knowledge.length ? i.knowledge.map((k, n) => `[${n + 1}] Q: ${k.question}\nA: ${k.answer}`).join('\n') : '(none yet)'}

AVAILABLE SLOTS:
${!i.bookingEnabled ? '(online booking is off: offer to have a counsellor arrange a time)' : i.slots.length ? i.slots.map((s, n) => `${n + 1}. ${s}`).join('\n') : '(no free slots in the next two weeks)'}

CONVERSATION SO FAR:
${i.history.length ? i.history.map((h) => `${h.from}: ${h.text}`).join('\n') : '(this is the first message)'}

FIRST REPLY: ${i.firstReply ? 'yes' : 'no'}

NEW MESSAGE FROM CUSTOMER:
${i.message}`;
}

export async function assistantTurn(tenantId: string, input: AssistantInput) {
  return runStructured({
    tenantId,
    task: 'whatsapp_reply',
    tier: 'smart',
    maxTokens: 800,
    system: SYSTEM,
    prompt: prompt(input),
    schema: assistantTurnSchema,
    fallback: () => heuristicTurn(input),
  });
}

// ── Sandbox fallback: keyword rules ─────────────────────────────────────────

const STOP = new Set(['what', 'when', 'where', 'which', 'your', 'have', 'does', 'with', 'from', 'that', 'this', 'there', 'about', 'would', 'could', 'please', 'want', 'need', 'know', 'tell', 'much', 'many', 'they', 'them', 'will', 'should', 'like',
  // Too common in this business to signal a topic on their own.
  'visa', 'visas', 'apply', 'application']);
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !STOP.has(w)) ?? []);

export function matchKnowledge(message: string, knowledge: { question: string; answer: string }[]) {
  const m = words(message);
  let best: { item: (typeof knowledge)[number]; score: number } | null = null;
  for (const item of knowledge) {
    const q = words(item.question);
    const a = words(item.answer);
    let score = 0;
    for (const w of m) score += q.has(w) ? 2 : a.has(w) ? 1 : 0;
    if (score > (best?.score ?? 0)) best = { item, score };
  }
  return best && best.score >= 2 ? best.item : null;
}

const none = { handoff: null, book: null, offerSlots: false, capture: null };

const NOT_A_NAME = new Set([
  'and', 'or', 'i', 'im', 'am', 'my', 'name', 'is', 'its', 'it', 'this', 'from', 'to', 'for', 'in', 'the', 'a', 'want', 'go', 'going', 'planning', 'plan',
  'hi', 'hello', 'hey', 'ok', 'okay', 'yes', 'no', 'sir', 'madam', 'study', 'studies', 'work', 'pr', 'visa', 'country', 'told', 'you', 'u', 'already', 'me',
]);
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

/** A name, either stated ("My name is Ravi") or given as a short answer right after we asked for it ("Mugundan and America"). */
function extractName(text: string, justAsked: boolean): { first: string; last: string | null } | null {
  // Case-insensitive lead-in, but the name itself must be capitalised ("I am interested" is not a name).
  const stated = text.match(/\b(?:[Mm]y name is|I am|I'm|[Tt]his is|[Ii]t'?s)\s+([A-Z][a-z]+)(?:\s+([A-Z][a-z]+))?/);
  if (stated) return { first: stated[1]!, last: stated[2] ?? null };
  if (!justAsked || text.split(/\s+/).length > 6) return null;
  const tokens = text
    .split(/[\s,.!?;:]+/)
    .filter((w) => /^[a-z]{2,}$/i.test(w) && !NOT_A_NAME.has(w.toLowerCase()) && !detectCountry(w) && !detectCategory(w));
  return tokens.length ? { first: cap(tokens[0]!), last: tokens[1] && tokens.length === 2 ? cap(tokens[1]) : null } : null;
}

const askedForName = (t?: string) => Boolean(t && /your name/i.test(t));

/** Everything the customer has told us in this conversation so far (the sandbox has no memory otherwise). */
function knownFacts(i: AssistantInput, text: string) {
  let name: { first: string; last: string | null } | null = null;
  let country: string | null = null;
  let category: string | null = null;
  let lastAssistant: string | undefined;
  for (const h of [...i.history, { from: 'customer' as const, text }]) {
    if (h.from !== 'customer') {
      lastAssistant = h.text;
      continue;
    }
    name = extractName(h.text, askedForName(lastAssistant)) ?? name;
    country = detectCountry(h.text) ?? country;
    category = detectCategory(h.text) ?? category;
  }
  return { name, country, category };
}

/** Ask only for what we don't know yet. */
function nextQuestion(name: string | null, country: string | null, category: string | null, interest?: string | null) {
  const where = country ? spokenCountry(country) : null;
  if (!name && !where && !interest) return 'May I know your name, and which country you are planning for?';
  if (!name) return `${where ? `${where.charAt(0).toUpperCase()}${where.slice(1)}, great choice. ` : ''}May I know your name?`;
  if (!where && !interest) return `Nice to meet you, ${name}! Which country are you planning for?`;
  const plan = where ? `${category === 'STUDY' ? 'study in' : category === 'PR' ? 'move to' : category === 'WORK' ? 'work in' : 'go to'} ${where}` : 'your plans';
  return `Thanks, ${name}! I can answer questions about how to ${plan === 'your plans' ? 'get started' : plan}, or book you a free consultation with a counsellor. What would you like?`;
}

export function heuristicTurn(i: AssistantInput): AssistantTurn {
  const text = i.message.trim();
  const lower = text.toLowerCase();
  const hello = i.firstReply ? `Hi${i.contact.name ? ` ${i.contact.name.split(' ')[0]}` : ''}! I'm ${i.assistantName}, ${i.agency}'s virtual assistant. ` : '';

  // What did they tell us, in this message and earlier ones?
  const lastAssistant = [...i.history].reverse().find((h) => h.from === 'assistant')?.text;
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? null;
  const named = extractName(text, askedForName(lastAssistant));
  const country = detectCountry(text);
  const category = detectCategory(text);
  const capture =
    email || named || country || category
      ? { firstName: named?.first ?? null, lastName: named?.last ?? null, email, interestCountry: country, interestCategory: category, notes: null }
      : null;
  const facts = knownFacts(i, text);
  const knownName = i.contact.name?.split(' ')[0] ?? facts.name?.first ?? null;
  const follow = () => nextQuestion(knownName, facts.country, facts.category, i.contact.interest);

  if (/\b(human|real person|agent|counsell?or|call me|complain|not happy|unhappy|angry|refund|manager|speak to someone)\b/i.test(lower)) {
    return { ...none, capture, reply: `${hello}I'll ask a counsellor to reply to you here shortly.`, confidence: 'high', handoff: { reason: 'Customer asked for a person' } };
  }

  const lastOffered = [...i.history].reverse().find((h) => h.from === 'assistant')?.text.includes('Reply with the number');
  const pick = text.match(/^\s*(?:option\s*|slot\s*|#)?([1-6])\b/i);
  if (lastOffered && pick && i.slots[Number(pick[1]) - 1]) {
    const n = Number(pick[1]);
    const mode = /video|online|zoom|google meet/i.test(lower) ? 'VIDEO' : /phone|call/i.test(lower) ? 'PHONE' : 'IN_PERSON';
    return { ...none, capture, reply: `Booked: ${i.slots[n - 1]} (${mode === 'VIDEO' ? 'video call' : mode === 'PHONE' ? 'phone call' : 'at our office'}). We'll send a reminder. See you then!`, confidence: 'high', book: { slot: n, mode } };
  }

  if (/\b(book|appointment|meet|meeting|consult|consultation|slot|visit (your|the) office)\b/i.test(lower)) {
    if (!i.bookingEnabled || !i.slots.length) {
      return { ...none, capture, reply: `${hello}I'll ask a counsellor to arrange a time with you.`, confidence: 'medium', handoff: { reason: 'Wants an appointment; no online slots' } };
    }
    const list = i.slots.slice(0, 6).map((s, n) => `${n + 1}. ${s}`).join('\n');
    return { ...none, capture, reply: `${hello}Here are the next free consultation times:\n${list}\nReply with the number that suits you (add "video" or "phone" if you can't come in).`, confidence: 'high', offerSlots: true };
  }

  if (/\b(status|update|progress|my (file|case|application)|stage|documents? (needed|pending|left))\b/i.test(lower)) {
    if (i.contact.cases.length) {
      const lines = i.contact.cases.map((c) => `${c.product}: now at "${c.stage}"${c.pendingDocs.length ? `. Still needed: ${c.pendingDocs.join(', ')}` : ''}.`);
      return { ...none, capture, reply: `${hello}${lines.join('\n')}${i.contact.nextAppointment ? `\nYour next appointment: ${i.contact.nextAppointment}.` : ''}`, confidence: 'high' };
    }
    return { ...none, capture, reply: `${hello}I couldn't find an open application for this number. A counsellor will check and reply.`, confidence: 'low', handoff: { reason: 'Asked for a case status; no open case found' } };
  }

  if (/\b(pay|payment|fee|fees|invoice|due|balance)\b/i.test(lower) && i.contact.amountDue) {
    return { ...none, capture, reply: `${hello}Your amount due is ${i.contact.amountDue}. You can pay securely from your client portal, or reply here and we'll send a payment link.`, confidence: 'high' };
  }

  const kb = matchKnowledge(text, i.knowledge);
  if (kb) return { ...none, capture, reply: `${hello}${kb.answer}`, confidence: 'high' };

  // "I told you" / "already said": apologise and carry on with what we know.
  if (/\b(i told (you|u)|told u|already (told|said|gave)|i said)\b/i.test(lower)) {
    return { ...none, capture, reply: `Sorry about that! ${follow()}`, confidence: 'high' };
  }

  if (/^(hi|hello|hey|hii+|namaste|vanakkam|sat sri akal|good (morning|afternoon|evening))\b/i.test(lower) || (capture && text.length < 120)) {
    return { ...none, capture, reply: `${hello}${follow()}`, confidence: 'high' };
  }

  return { ...none, capture, reply: `${hello}Good question. I'll check with a counsellor and they'll reply here soon.`, confidence: 'low', handoff: { reason: 'Assistant could not answer' } };
}
