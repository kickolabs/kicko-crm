import { createHmac } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET ??= 'test-secret-test-secret-test-secret';
});

describe('storage tokens', async () => {
  const { signToken, verifyToken, newKey, assertKey } = await import('./storage');
  const key = 'tenants/abc123/documents/x.pdf';

  it('round-trips a valid token', () => {
    const t = signToken({ k: key, op: 'get', exp: Date.now() + 60_000 });
    expect(verifyToken(t, 'get')?.k).toBe(key);
  });
  it('rejects the wrong operation', () => {
    expect(verifyToken(signToken({ k: key, op: 'get', exp: Date.now() + 60_000 }), 'put')).toBeNull();
  });
  it('rejects expired tokens', () => {
    expect(verifyToken(signToken({ k: key, op: 'get', exp: Date.now() - 1 }), 'get')).toBeNull();
  });
  it('rejects tampered payloads', () => {
    const [, sig] = signToken({ k: key, op: 'get', exp: Date.now() + 60_000 }).split('.');
    const forged = Buffer.from(JSON.stringify({ k: 'tenants/other/documents/y.pdf', op: 'get', exp: Date.now() + 60_000 })).toString('base64url');
    expect(verifyToken(`${forged}.${sig}`, 'get')).toBeNull();
  });
  it('blocks path traversal keys', () => {
    expect(() => assertKey('tenants/abc/../../etc/passwd')).toThrow();
    expect(() => assertKey('/etc/passwd')).toThrow();
    expect(newKey('abc123', 'documents', 'application/pdf')).toMatch(/^tenants\/abc123\/documents\/.+\.pdf$/);
  });
});

describe('razorpay webhook signature', async () => {
  const { verifyRazorpaySignature: verifyWebhookSignature } = await import('@/integrations/payments/razorpay');
  const body = JSON.stringify({ event: 'payment_link.paid' });
  const sig = createHmac('sha256', 'whsec').update(body).digest('hex');
  it('accepts a correct signature', () => expect(verifyWebhookSignature(body, sig, 'whsec')).toBe(true));
  it('rejects a wrong secret', () => expect(verifyWebhookSignature(body, sig, 'other')).toBe(false));
  it('rejects a modified body', () => expect(verifyWebhookSignature(body + ' ', sig, 'whsec')).toBe(false));
  it('rejects a missing signature', () => expect(verifyWebhookSignature(body, null, 'whsec')).toBe(false));
});

describe('secrets', async () => {
  const { encryptSecret, decryptSecret } = await import('./secrets');
  it('encrypts and decrypts', () => {
    const blob = encryptSecret('rzp_secret_123');
    expect(blob).not.toContain('rzp_secret_123');
    expect(decryptSecret(blob)).toBe('rzp_secret_123');
  });
  it('detects tampering', () => {
    const [v, iv, tag, data] = encryptSecret('abc').split('.');
    const flipped = Buffer.from(data!, 'base64url');
    flipped[0] = flipped[0]! ^ 1;
    expect(() => decryptSecret([v, iv, tag, flipped.toString('base64url')].join('.'))).toThrow();
  });
});

describe('billing helpers', async () => {
  const { financialYear } = await import('./billing');
  const { expectedCommission } = await import('./partners');
  it('uses the Indian April–March financial year', () => {
    expect(financialYear(new Date('2026-10-20T06:00:00Z'), 'Asia/Kolkata')).toBe('26-27');
    expect(financialYear(new Date('2027-03-31T17:00:00Z'), 'Asia/Kolkata')).toBe('26-27');
    expect(financialYear(new Date('2027-03-31T19:00:00Z'), 'Asia/Kolkata')).toBe('27-28'); // 1 Apr 00:30 IST
  });
  it('computes percentage and flat commissions', () => {
    expect(expectedCommission({ commissionType: 'PERCENT', commissionValue: 1500 }, 1_895_000)).toBe(284_250);
    expect(expectedCommission({ commissionType: 'FLAT', commissionValue: 200_000 }, null)).toBe(200_000);
    expect(expectedCommission({ commissionType: 'PERCENT', commissionValue: 1500 }, null)).toBe(0);
  });
});
