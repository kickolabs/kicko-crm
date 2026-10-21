import { describe, expect, it } from 'vitest';
import { inboundText, sign, templatePayload, textPayload, toWaId, verifySignature, type WaInbound } from './meta';

describe('WhatsApp payloads (Meta Cloud API shapes)', () => {
  it('strips the + and spaces from recipients', () => {
    expect(toWaId('+91 98400 11223')).toBe('919840011223');
  });

  it('builds a text message', () => {
    expect(textPayload('+919840011223', 'Hello')).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919840011223',
      type: 'text',
      text: { preview_url: true, body: 'Hello' },
    });
  });

  it('builds a template message with body parameters', () => {
    expect(templatePayload('+919840011223', 'case_update', 'en', ['Priya', 'Lodged'])).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919840011223',
      type: 'template',
      template: {
        name: 'case_update',
        language: { code: 'en' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Priya' }, { type: 'text', text: 'Lodged' }] }],
      },
    });
  });

  it('omits components for templates without variables', () => {
    expect(templatePayload('919', 'hello', 'en_US', []).template).toEqual({ name: 'hello', language: { code: 'en_US' } });
  });
});

describe('webhook signature', () => {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  it('accepts a valid X-Hub-Signature-256', () => expect(verifySignature(body, sign(body, 'appsecret'), 'appsecret')).toBe(true));
  it('rejects another secret', () => expect(verifySignature(body, sign(body, 'x'), 'appsecret')).toBe(false));
  it('rejects a tampered body', () => expect(verifySignature(`${body} `, sign(body, 'appsecret'), 'appsecret')).toBe(false));
  it('rejects missing/malformed headers', () => {
    expect(verifySignature(body, null, 'appsecret')).toBe(false);
    expect(verifySignature(body, 'md5=abc', 'appsecret')).toBe(false);
  });
});

describe('inbound message parsing', () => {
  const base = { from: '919840011223', id: 'wamid.X', timestamp: '1760000000' };
  it('text', () => expect(inboundText({ ...base, type: 'text', text: { body: 'Hi' } }).body).toBe('Hi'));
  it('document with filename', () => {
    const r = inboundText({ ...base, type: 'document', document: { id: 'M1', filename: 'passport.pdf', mime_type: 'application/pdf' } } as WaInbound);
    expect(r.body).toBe('Document: passport.pdf');
    expect(r.media).toEqual({ kind: 'document', id: 'M1', mime: 'application/pdf', name: 'passport.pdf' });
  });
  it('image caption wins', () => {
    expect(inboundText({ ...base, type: 'image', image: { id: 'M2', caption: 'my IELTS' } } as WaInbound).body).toBe('my IELTS');
  });
  it('button replies', () => {
    expect(inboundText({ ...base, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'y', title: 'Yes, call me' } } }).body).toBe('Yes, call me');
  });
});
