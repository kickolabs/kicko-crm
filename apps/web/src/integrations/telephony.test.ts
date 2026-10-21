import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { callNotesSchema, detectCategory, heuristicNotes } from '@/server/ai/call-notes';
import { sandboxStt } from './stt/sandbox';
import { exotel } from './telephony/exotel';
import type { Routing, TelephonyAdapter, WebhookInput } from './telephony/port';
import { telephonySandbox } from './telephony/sandbox';
import { CALL_SCRIPTS, parseSandboxRef, sandboxRecordingRef, sandboxWav } from './telephony/sandbox-scripts';
import { twilio, twilioSignature } from './telephony/twilio';

const ctx = { tenantId: 't1', slug: 'acme', appUrl: 'https://app.test' };
const names = { agent: 'Divya', contact: 'Priya', agency: 'Acme Visas' };

const input = (url: string, params: Record<string, string>, headers: Record<string, string> = {}, raw = ''): WebhookInput => {
  const u = new URL(url);
  return { method: 'POST', url: u, raw, headers: new Headers(headers), params: { ...Object.fromEntries(u.searchParams), ...params } };
};

const transcriptFor = async (id: string) => (await sandboxStt.transcribe({ bytes: Buffer.alloc(0), mime: 'audio/wav', sourceRef: sandboxRecordingRef(id, names) }))!;

describe('sandbox recordings and transcripts', () => {
  it('round-trips names through the recording reference', () => {
    expect(parseSandboxRef(sandboxRecordingRef('pr-australia', names))).toMatchObject({ script: { id: 'pr-australia' }, names });
    expect(parseSandboxRef('https://api.twilio.com/rec/RE1')).toBeNull();
  });
  it('produces a playable WAV', () => {
    const wav = sandboxWav(1);
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.length).toBe(44 + 8000 * 2);
  });
  it('returns the personalised script as a transcript', async () => {
    const t = await transcriptFor('study-canada');
    expect(t.segments[0]).toMatchObject({ speaker: 'agent', text: 'Hello, this is Divya from Acme Visas. Am I speaking with Priya?' });
    expect(t.durationSec).toBe(214);
  });
  it("can't transcribe real audio", async () => {
    expect(await sandboxStt.transcribe({ bytes: Buffer.alloc(10), mime: 'audio/mpeg', sourceRef: 'https://x/rec.mp3' })).toBeNull();
  });
});

describe('sandbox call notes (no model)', () => {
  it('picks up a study enquiry', async () => {
    const n = heuristicNotes((await transcriptFor('study-canada')).segments);
    expect(n.fields).toMatchObject({ interestCountry: 'CA', interestCategory: 'STUDY', englishTest: 'IELTS 7.0', intake: 'September 2027', budget: '25 lakhs' });
    expect(n.nextSteps).toContain('Send the document checklist');
    expect(n.tasks.length).toBeGreaterThan(0);
    expect(n.sentiment).toBe('positive');
  });
  it('picks up a PR points query', async () => {
    const n = heuristicNotes((await transcriptFor('pr-australia')).segments);
    expect(n.fields).toMatchObject({ interestCountry: 'AU', interestCategory: 'PR', age: 31, occupation: 'software engineer', englishTest: 'PTE 79' });
  });
  it('records a decline plainly, with the reason and no follow-ups', () => {
    const n = heuristicNotes([
      { speaker: 'agent', start: 0, end: 5, text: 'Hi Meera, this is Asha, an AI assistant from Acme about your enquiry. Is now a good time?' },
      { speaker: 'contact', start: 6, end: 9, text: "Sorry, I'm not interested any more. I've already joined another agency." },
      { speaker: 'agent', start: 10, end: 13, text: 'No problem at all, thank you for letting us know.' },
    ]);
    expect(n).toMatchObject({ summary: 'Not interested: already joined another agency. No follow-up needed.', sentiment: 'neutral', nextSteps: [], tasks: [] });
  });
  it('says so when nothing was discussed', () => {
    expect(heuristicNotes([{ speaker: 'contact', start: 0, end: 2, text: 'Hello? Who is this?' }]).summary).toBe('Short call. No visa details were discussed.');
  });
  it('recognises visa types in natural phrasing', () => {
    expect(detectCategory('Permanent residency, the 189 visa')).toBe('PR');
    expect(detectCategory('Canada Express Entry')).toBe('PR');
    expect(detectCategory('a postgraduate diploma')).toBe('STUDY');
  });
  it('flags an unhappy client', async () => {
    const n = heuristicNotes((await transcriptFor('fee-followup')).segments);
    expect(n).toMatchObject({ sentiment: 'negative', intent: 'complaint' });
    expect(n.nextSteps).toEqual(expect.arrayContaining(['Send a written case update on WhatsApp', 'Send a payment link']));
  });
  it('every script yields notes that satisfy the AI schema', async () => {
    for (const s of CALL_SCRIPTS) expect(callNotesSchema.safeParse(heuristicNotes((await transcriptFor(s.id)).segments)).success, s.id).toBe(true);
  });
  it('the schema converts to JSON Schema for structured output', () => {
    const js = z.toJSONSchema(callNotesSchema) as { type: string; required: string[] };
    expect(js.type).toBe('object');
    expect(js.required).toEqual(expect.arrayContaining(['summary', 'tasks', 'fields']));
  });
});

describe('twilio adapter', () => {
  const cfg: Record<string, string> = { accountSid: `AC${'0'.repeat(32)}`, authToken: 'tok', callerId: '+14155550100', ...twilio.setup!(null) };
  const a = twilio.create(cfg, ctx) as TelephonyAdapter;
  const base = `https://app.test/api/webhooks/telephony/twilio/acme?event=inbound&token=${cfg.webhookToken}`;
  const body = { CallSid: 'CA1', From: '+919840011223', To: '+14155550100', CallStatus: 'ringing' };

  it('verifies X-Twilio-Signature and the URL token', () => {
    const sig = twilioSignature('tok', base, body);
    expect(a.parseWebhook(input(base, body, { 'x-twilio-signature': sig }))).toEqual([{ type: 'call.incoming', providerCallId: 'CA1', from: '+919840011223', to: '+14155550100' }]);
    expect(a.parseWebhook(input(base, body, { 'x-twilio-signature': 'forged' }))).toBeNull();
    const wrongToken = base.replace(cfg.webhookToken!, 'nope');
    expect(a.parseWebhook(input(wrongToken, body, { 'x-twilio-signature': twilioSignature('tok', wrongToken, body) }))).toBeNull();
  });
  it('maps recording and dial callbacks', () => {
    const rec = base.replace('event=inbound', 'event=recording') + '&call=c1';
    const rb = { CallSid: 'CA1', RecordingUrl: 'https://api.twilio.com/rec/RE1', RecordingChannels: '2', RecordingDuration: '61' };
    expect(a.parseWebhook(input(rec, rb, { 'x-twilio-signature': twilioSignature('tok', rec, rb) }))).toEqual([
      { type: 'call.recording', providerCallId: 'CA1', callId: 'c1', ref: 'https://api.twilio.com/rec/RE1', channels: 'dual', durationSec: 61 },
    ]);
    const dial = base.replace('event=inbound', 'event=dialed');
    const db = { CallSid: 'CA1', DialCallStatus: 'no-answer' };
    expect(a.parseWebhook(input(dial, db, { 'x-twilio-signature': twilioSignature('tok', dial, db) }))).toMatchObject([{ type: 'call.status', status: 'no-answer' }]);
  });
  it('routes inbound calls with consent, recording and escaped TwiML', () => {
    const routing: Routing = { callId: 'c1', forwardTo: ['+919999900000'], record: true, greeting: 'Calls are recorded & reviewed', callbacks: (e) => `https://app.test/cb?event=${e}&x=1` };
    const { body: xml } = a.respond('inbound', routing);
    expect(xml).toContain('<Say>Calls are recorded &amp; reviewed</Say>');
    expect(xml).toContain('<Number>+919999900000</Number>');
    expect(xml).toContain('record="record-from-answer-dual"');
    expect(xml).toContain('event=recording&amp;x=1');
    expect(a.respond('inbound', { ...routing, forwardTo: [] }).body).toContain('<Hangup/>');
  });
});

describe('exotel adapter', () => {
  const cfg: Record<string, string> = { accountSid: 'acme1', apiKey: 'k', apiToken: 't', subdomain: 'api.in.exotel.com', callerId: '+918047000000', ...exotel.setup!(null) };
  const a = exotel.create(cfg, ctx) as TelephonyAdapter;
  const url = (e: string) => `https://app.test/api/webhooks/telephony/exotel/acme?event=${e}&token=${cfg.webhookToken}`;
  it('only accepts callbacks carrying the secret token', () => {
    expect(a.parseWebhook(input(url('status').replace(cfg.webhookToken!, 'x'), { CallSid: 's', Status: 'completed' }))).toBeNull();
  });
  it('maps terminal status callbacks with the recording', () => {
    expect(a.parseWebhook(input(url('status'), { CallSid: 's1', Status: 'completed', ConversationDuration: '95', RecordingUrl: 'https://recordings.exotel.com/a.mp3', CustomField: 'c9' }))).toEqual([
      { type: 'call.status', providerCallId: 's1', callId: 'c9', status: 'completed', durationSec: 95, recording: { ref: 'https://recordings.exotel.com/a.mp3', channels: 'dual' } },
    ]);
  });
  it('answers the Connect applet with the numbers to dial', () => {
    expect(a.parseWebhook(input(url('inbound'), { CallSid: 's2', CallFrom: '09840011223', CallTo: '08047000000' }))).toMatchObject([{ type: 'call.incoming', from: '09840011223' }]);
    const r = JSON.parse(a.respond('inbound', { callId: 'c', forwardTo: ['+919999900000'], record: true, callbacks: () => '' }).body);
    expect(r).toMatchObject({ destination: { numbers: ['+919999900000'] }, record: true, outgoing_phone_number: '+918047000000' });
  });
});

describe('sandbox telephony adapter', () => {
  const cfg = telephonySandbox.setup!(null);
  const a = telephonySandbox.create(cfg, ctx) as TelephonyAdapter;
  it('translates simulator callbacks and checks the token', () => {
    const raw = JSON.stringify({ kind: 'status', providerCallId: 'CA_SBX1', status: 'completed', durationSec: 10, recordingRef: 'sandbox:study-canada:' });
    const u = `https://app.test/x?event=status&call=c1&token=${cfg.webhookToken}`;
    expect(a.parseWebhook(input(u, {}, {}, raw))).toEqual([
      { type: 'call.status', providerCallId: 'CA_SBX1', callId: 'c1', status: 'completed', durationSec: 10, recording: { ref: 'sandbox:study-canada:', channels: 'mono' } },
    ]);
    expect(a.parseWebhook(input('https://app.test/x?event=status&token=bad', {}, {}, raw))).toBeNull();
  });
  it('serves sandbox recordings only', async () => {
    expect((await a.fetchRecording(sandboxRecordingRef('study-canada', names))).mime).toBe('audio/wav');
    await expect(a.fetchRecording('https://evil.test/a.mp3')).rejects.toThrow();
  });
});
