import { describe, expect, it } from 'vitest';
import { leadScore, nextOpening } from '@/server/voice/service';
import type { WebhookInput } from './telephony/port';
import { bolna, parseBolnaTranscript, toBolnaVars } from './voice/bolna';
import type { VoiceAgentAdapter } from './voice/port';
import { retell, retellSignature, verifyRetell } from './voice/retell';
import { voiceSandbox } from './voice/sandbox';

const ctx = { tenantId: 't1', slug: 'acme', appUrl: 'https://app.test' };
const input = (url: string, raw: string, headers: Record<string, string> = {}): WebhookInput => ({
  method: 'POST',
  url: new URL(url),
  raw,
  headers: new Headers(headers),
  params: Object.fromEntries(new URL(url).searchParams),
});

describe('retell', () => {
  const cfg: Record<string, string> = { apiKey: 'key_123', fromNumber: '+14155550100', ...retell.setup!(null) };
  const a = retell.create(cfg, ctx) as VoiceAgentAdapter;
  const url = `https://app.test/api/webhooks/voice_agent/retell/acme?event=webhook&token=${cfg.webhookToken}`;

  it('verifies x-retell-signature (HMAC of body + timestamp, 5-minute window)', () => {
    const body = '{"event":"call_started"}';
    expect(verifyRetell(body, 'key_123', retellSignature(body, 'key_123'))).toBe(true);
    expect(verifyRetell(body, 'key_123', retellSignature(body, 'other'))).toBe(false);
    expect(verifyRetell(body + ' ', 'key_123', retellSignature(body, 'key_123'))).toBe(false);
    expect(verifyRetell(body, 'key_123', retellSignature(body, 'key_123', Date.now() - 10 * 60_000))).toBe(false);
    expect(verifyRetell(body, 'key_123', null)).toBe(false);
  });

  it('turns call_analyzed into a finished call with transcript and analysis', () => {
    const raw = JSON.stringify({
      event: 'call_analyzed',
      call: {
        call_id: 'call_1',
        direction: 'outbound',
        from_number: '+14155550100',
        to_number: '+919840011223',
        start_timestamp: 1_000_000,
        end_timestamp: 1_095_000,
        disconnection_reason: 'agent_hangup',
        transcript_object: [
          { role: 'agent', content: 'Hi Priya', words: [{ start: 0.2, end: 0.9 }] },
          { role: 'user', content: 'Hello', words: [{ start: 1.5, end: 2 }] },
        ],
        recording_url: 'https://rec.retell/1.wav',
        metadata: { call_id: 'kicko_c1' },
        call_analysis: { call_summary: 'Wants Canada', custom_analysis_data: { destination: 'Canada' } },
      },
    });
    expect(a.parseWebhook(input(url, raw, { 'x-retell-signature': retellSignature(raw, 'key_123') }))).toEqual({
      kind: 'events',
      events: [
        {
          type: 'call.ended', providerCallId: 'call_1', callId: 'kicko_c1', direction: 'OUTBOUND', from: '+14155550100', to: '+919840011223',
          status: 'completed', durationSec: 95, recordingUrl: 'https://rec.retell/1.wav', summary: 'Wants Canada', extracted: { destination: 'Canada' },
          transcript: [
            { speaker: 'agent', start: 0.2, end: 0.9, text: 'Hi Priya' },
            { speaker: 'contact', start: 1.5, end: 2, text: 'Hello' },
          ],
        },
      ],
    });
  });

  it('maps no-answer, tool calls and the inbound webhook', () => {
    const sign = (o: unknown) => {
      const raw = JSON.stringify(o);
      return input(url, raw, { 'x-retell-signature': retellSignature(raw, 'key_123') });
    };
    const missed = a.parseWebhook(sign({ event: 'call_analyzed', call: { call_id: 'c2', disconnection_reason: 'dial_no_answer' } }));
    expect(missed).toMatchObject({ events: [{ status: 'no-answer' }] });
    expect(a.parseWebhook(sign({ name: 'book_appointment', args: { slot_id: 'x' }, call: { call_id: 'c3', metadata: { call_id: 'k3' } } }))).toMatchObject({
      kind: 'tool',
      tool: { name: 'book_appointment', args: { slot_id: 'x' }, callId: 'k3' },
    });
    expect(a.parseWebhook(sign({ event: 'call_inbound', call_inbound: { from_number: '+911', to_number: '+912' } }))).toEqual({ kind: 'inbound', from: '+911', to: '+912' });
    expect(JSON.parse(a.respond({ kind: 'inbound', variables: { opening: 'Hi' } }).body)).toEqual({ call_inbound: { dynamic_variables: { opening: 'Hi' }, metadata: {} } });
  });

  it('rejects unsigned callbacks or a wrong token', () => {
    expect(a.parseWebhook(input(url, '{}'))).toBeNull();
    const raw = '{}';
    expect(a.parseWebhook(input(url.replace(cfg.webhookToken!, 'x'), raw, { 'x-retell-signature': retellSignature(raw, 'key_123') }))).toBeNull();
  });
});

describe('bolna', () => {
  const cfg: Record<string, string> = { apiKey: 'bn_key', agentId: 'agent-1', ...bolna.setup!(null) };
  const a = bolna.create(cfg, ctx) as VoiceAgentAdapter;
  const url = (e: string, extra = '') => `https://app.test/api/webhooks/voice_agent/bolna/acme?event=${e}&token=${cfg.webhookToken}${extra}`;

  it('converts prompt variables and transcripts', () => {
    expect(toBolnaVars('Hi {{contact_first_name}}, ref {{call_ref}}')).toBe('Hi {contact_first_name}, ref {call_ref}');
    expect(parseBolnaTranscript('assistant: Hello Priya\nuser: Hi\nthere\nassistant: Great')).toEqual([
      { speaker: 'agent', start: 0, end: 0, text: 'Hello Priya' },
      { speaker: 'contact', start: 0, end: 0, text: 'Hi there' },
      { speaker: 'agent', start: 0, end: 0, text: 'Great' },
    ]);
  });

  it('only finishes calls on terminal statuses', () => {
    const exec = (status: string) =>
      JSON.stringify({
        id: 'exec_1', status, conversation_duration: 64.4, transcript: 'assistant: Hi\nuser: Hello', summary: 'Short call',
        extracted_data: { destination: 'UK' }, context_details: { recipient_data: { call_ref: 'k1' } },
        telephony_data: { recording_url: 'https://r/1.mp3', to_number: '+919840011223', from_number: '+918000000000', call_type: 'outbound' },
      });
    expect(a.parseWebhook(input(url('webhook'), exec('in-progress')))).toEqual({ kind: 'events', events: [] });
    expect(a.parseWebhook(input(url('webhook'), exec('completed')))).toMatchObject({
      events: [{ type: 'call.ended', providerCallId: 'exec_1', callId: 'k1', status: 'completed', durationSec: 64, direction: 'OUTBOUND', recordingUrl: 'https://r/1.mp3', extracted: { destination: 'UK' } }],
    });
    expect(a.parseWebhook(input(url('webhook'), exec('no-answer')))).toMatchObject({ events: [{ status: 'no-answer' }] });
  });

  it('reads tool calls and checks the token', () => {
    expect(a.parseWebhook(input(url('tool', '&name=save_lead_details'), JSON.stringify({ call_ref: 'k1', destination: 'Canada' })))).toEqual({
      kind: 'tool',
      tool: { name: 'save_lead_details', args: { call_ref: 'k1', destination: 'Canada' }, callId: 'k1', callerPhone: undefined },
    });
    expect(a.parseWebhook(input(url('webhook').replace(cfg.webhookToken!, 'nope'), '{}'))).toBeNull();
  });
});

describe('voice sandbox', () => {
  const cfg = voiceSandbox.setup!(null);
  const a = voiceSandbox.create(cfg, ctx) as VoiceAgentAdapter;
  it('passes events through after the token check, and serves sandbox recordings only', async () => {
    const raw = JSON.stringify({ kind: 'tool', name: 'get_available_slots', args: { call_ref: 'k1' } });
    expect(a.parseWebhook(input(`https://app.test/x?event=tool&token=${cfg.webhookToken}`, raw))).toMatchObject({ kind: 'tool', tool: { name: 'get_available_slots' } });
    expect(a.parseWebhook(input('https://app.test/x?event=tool&token=bad', raw))).toBeNull();
    expect((await a.fetchRecording('sandbox-voice:student-canada')).mime).toBe('audio/wav');
    await expect(a.fetchRecording('https://evil.test/x.wav')).rejects.toThrow();
  });
});

describe('lead scoring and calling hours', () => {
  it('scores completeness and a booked consultation', () => {
    expect(leadScore({}, false)).toBe(10);
    expect(leadScore({ destination: 'Canada', visa_type: 'Study', intake: 'Sep', english_test: 'IELTS 7', education: 'B.Tech', budget: '25L' }, true)).toBe(100);
    expect(leadScore({ destination: 'Canada', interested: false }, false)).toBe(5);
  });
  it('waits for the next calling window', () => {
    const cfg = { days: [1, 2, 3, 4, 5, 6], start: '10:00', end: '19:00' };
    // Sunday 25 Oct 2026, 15:00 IST → Monday 10:00 IST (04:30 UTC)
    expect(nextOpening(cfg, 'Asia/Kolkata', new Date('2026-10-25T09:30:00Z')).toISOString()).toBe('2026-10-26T04:30:00.000Z');
    // Monday 08:00 IST → same day 10:00
    expect(nextOpening(cfg, 'Asia/Kolkata', new Date('2026-10-26T02:30:00Z')).toISOString()).toBe('2026-10-26T04:30:00.000Z');
    // Inside hours → now
    const inside = new Date('2026-10-26T06:00:00Z');
    expect(nextOpening(cfg, 'Asia/Kolkata', inside)).toBe(inside);
  });
});
