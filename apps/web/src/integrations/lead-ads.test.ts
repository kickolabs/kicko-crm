import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { metaLeadAds } from './lead-ads/meta';
import { mapAnswers } from './lead-ads/port';
import { leadAdsSandbox, leadAdsSignature } from './lead-ads/sandbox';

const ctx = { tenantId: 't', slug: 's', appUrl: 'http://x' };

describe('lead ads', () => {
  it('maps standard and custom lead-form fields', () => {
    expect(mapAnswers({ full_name: 'Ravi Kumar', phone_number: '+919840011111', email: 'r@x.in', destination_country: 'Germany', comments: 'Nurse' })).toEqual({
      fullName: 'Ravi Kumar', firstName: undefined, lastName: undefined, email: 'r@x.in', phone: '+919840011111', country: 'Germany', message: 'Nurse',
    });
  });

  it('sandbox: accepts a correctly signed submission and refuses a forged one', async () => {
    const a = leadAdsSandbox.create({ webhookSecret: 'shh' }, ctx);
    const raw = JSON.stringify({ id: 'L1', answers: { full_name: 'Asha', phone_number: '9840000000' }, campaign: 'Gulf drivers' });
    const ok = await a.parseWebhook({ method: 'POST', url: new URL('http://x'), raw, headers: new Headers({ 'x-sandbox-signature': leadAdsSignature(raw, 'shh') }) });
    expect(ok).toMatchObject({ kind: 'leads', leads: [{ externalId: 'L1', campaign: 'Gulf drivers', fields: { fullName: 'Asha', phone: '9840000000' } }] });
    expect(await a.parseWebhook({ method: 'POST', url: new URL('http://x'), raw, headers: new Headers({ 'x-sandbox-signature': 'nope' }) })).toBeNull();
  });

  it('meta: answers the subscription check only with the right verify token, and checks the signature', async () => {
    const a = metaLeadAds.create({ verifyToken: 'vt', appSecret: 'app', pageAccessToken: 'p' }, ctx);
    const challenge = new URL('http://x/?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=123');
    expect(await a.parseWebhook({ method: 'GET', url: challenge, raw: '', headers: new Headers() })).toEqual({ kind: 'challenge', body: '123' });
    expect(await a.parseWebhook({ method: 'GET', url: new URL('http://x/?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=1'), raw: '', headers: new Headers() })).toBeNull();
    const raw = JSON.stringify({ object: 'instagram', entry: [] });
    const sig = `sha256=${createHmac('sha256', 'app').update(raw).digest('hex')}`;
    expect(await a.parseWebhook({ method: 'POST', url: new URL('http://x'), raw, headers: new Headers({ 'x-hub-signature-256': sig }) })).toEqual({ kind: 'leads', leads: [] });
    expect(await a.parseWebhook({ method: 'POST', url: new URL('http://x'), raw, headers: new Headers({ 'x-hub-signature-256': 'sha256=00' }) })).toBeNull();
  });
});
