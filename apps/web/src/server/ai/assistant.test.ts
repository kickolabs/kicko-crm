import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { assistantTurnSchema, heuristicTurn, matchKnowledge, type AssistantInput } from './assistant';

const base: AssistantInput = {
  agency: 'Acme Visas',
  assistantName: 'Asha',
  now: '21 Oct 2026, 9:30 pm',
  officeHours: 'Mon–Sat 10:00–18:00',
  officeOpen: false,
  contact: { kind: 'lead', name: null, cases: [], nextAppointment: null, amountDue: null },
  knowledge: [
    { question: 'What documents do I need for a student visa?', answer: 'Passport, transcripts, IELTS score, SOP and proof of funds.' },
    { question: 'What are your office hours?', answer: 'Monday to Saturday, 10 to 6.' },
  ],
  slots: ['Thu 22 Oct, 10:00 am', 'Thu 22 Oct, 2:00 pm', 'Fri 23 Oct, 10:00 am'],
  bookingEnabled: true,
  history: [],
  firstReply: true,
  message: '',
};
const turn = (message: string, over: Partial<AssistantInput> = {}) => heuristicTurn({ ...base, ...over, message });

describe('sandbox WhatsApp assistant', () => {
  it('introduces itself and asks for a name on the first message', () => {
    const t = turn('Hi');
    expect(t.reply).toMatch(/^Hi! I'm Asha, Acme Visas's virtual assistant\. May I know your name/);
    expect(t.confidence).toBe('high');
  });
  it('answers from the knowledge base', () => {
    expect(turn('what documents are needed for student visa?', { firstReply: false }).reply).toBe('Passport, transcripts, IELTS score, SOP and proof of funds.');
  });
  it('offers numbered slots, then books the chosen one', () => {
    const offer = turn('Can I book a consultation?', { firstReply: false });
    expect(offer.offerSlots).toBe(true);
    expect(offer.reply).toContain('2. Thu 22 Oct, 2:00 pm');
    const pick = turn('2, video please', { firstReply: false, history: [{ from: 'customer', text: 'book' }, { from: 'assistant', text: offer.reply }] });
    expect(pick.book).toEqual({ slot: 2, mode: 'VIDEO' });
    expect(pick.reply).toContain('Thu 22 Oct, 2:00 pm');
  });
  it("doesn't book a bare number out of context", () => {
    expect(turn('2', { firstReply: false }).book).toBeNull();
  });
  it('hands off when asked for a person or upset', () => {
    expect(turn('I want to speak to a counsellor').handoff).toEqual({ reason: 'Customer asked for a person' });
    expect(turn('I am not happy with your service').handoff).not.toBeNull();
  });
  it('shares case status for clients, and never invents one', () => {
    const client = { ...base.contact, kind: 'client' as const, name: 'Priya Raman', cases: [{ product: 'Canada Study Permit', stage: 'Lodged', pendingDocs: ['Medical exam'] }] };
    expect(turn('any update on my application?', { contact: client, firstReply: false }).reply).toBe('Canada Study Permit: now at "Lodged". Still needed: Medical exam.');
    const none = turn('status of my file?', { firstReply: false });
    expect(none.handoff).not.toBeNull();
    expect(none.confidence).toBe('low');
  });
  it('captures details the customer volunteers', () => {
    const t = turn('My name is Ravi Kumar, I want to do my masters in Canada. ravi@example.com', { firstReply: false });
    expect(t.capture).toMatchObject({ firstName: 'Ravi', lastName: 'Kumar', email: 'ravi@example.com', interestCountry: 'CA', interestCategory: 'STUDY' });
  });
  it('remembers what was said and only asks for what is missing', () => {
    // The conversation from the settings "Try it" chat that went in circles.
    const h: AssistantInput['history'] = [];
    const say = (m: string) => {
      const t = turn(m, { history: [...h], firstReply: h.length === 0 });
      h.push({ from: 'customer', text: m }, { from: 'assistant', text: t.reply });
      return t;
    };
    expect(say('Hi').reply).toContain('May I know your name, and which country');
    expect(say('America').reply).toBe('The US, great choice. May I know your name?');
    const named = say('Mugundan and America');
    expect(named.capture).toMatchObject({ firstName: 'Mugundan', interestCountry: 'US' });
    expect(named.reply).toMatch(/^Thanks, Mugundan! .*go to the US/);
    expect(say('i told u')).toMatchObject({ handoff: null, confidence: 'high' });
    expect(h.at(-1)!.text).toMatch(/^Sorry about that! Thanks, Mugundan!/);
  });
  it("doesn't take ordinary words as a name", () => {
    expect(turn('yes I want to study', { history: [{ from: 'assistant', text: 'May I know your name?' }], firstReply: false }).capture?.firstName ?? null).toBeNull();
  });
  it('hands off what it cannot answer', () => {
    const t = turn('Can my uncle sponsor my brother-in-law for a business visa?', { firstReply: false });
    expect(t).toMatchObject({ confidence: 'low', handoff: { reason: 'Assistant could not answer' } });
  });
  it('every reply satisfies the AI schema (same contract as the model)', () => {
    for (const m of ['Hi', 'book a slot', 'human please', 'office hours?', 'random question about quantum physics']) {
      expect(assistantTurnSchema.safeParse(turn(m)).success, m).toBe(true);
    }
    expect((z.toJSONSchema(assistantTurnSchema) as { type: string }).type).toBe('object');
  });
  it('knowledge matching needs real overlap', () => {
    expect(matchKnowledge('hello there', base.knowledge)).toBeNull();
    expect(matchKnowledge('office hours', base.knowledge)?.question).toBe('What are your office hours?');
  });
});
