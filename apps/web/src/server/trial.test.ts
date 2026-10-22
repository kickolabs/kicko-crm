import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, withTenant } from '@kicko/db';
import { provisionTenant } from '@kicko/db/provision';
import { isDisposableEmail } from '@/lib/disposable-emails';
import { limitMessage } from './branches';
import { parseMobile } from './phone-otp';
import { hashIp, startTrial } from './trial';

const run = Date.now().toString(36);
const users: string[] = [];
const tenants: string[] = [];

async function owner(phone: string | null) {
  const id = randomUUID();
  users.push(id);
  await prisma.user.create({ data: { id, name: 'Trial Test', email: `trial-${run}-${users.length}@example.test`, phoneNumber: phone, phoneNumberVerified: Boolean(phone) } });
  const t = await provisionTenant({ name: `Trial ${run}`, slug: `trial-${run}-${tenants.length}`, ownerUserId: id, trial: false });
  tenants.push(t.id);
  return { userId: id, tenantId: t.id };
}
const status = (tenantId: string) => withTenant(tenantId, (tx) => tx.subscription.findUniqueOrThrow({ where: { tenantId } })).then((s) => s.status);
const fresh = () => `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
const device = (deviceId: string | null = randomUUID()) => ({ deviceId, fingerprint: null, ip: null });

afterAll(async () => {
  await prisma.trialClaim.deleteMany({ where: { userId: { in: users } } });
  await prisma.trialReview.deleteMany({ where: { userId: { in: users } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
});

describe('one free trial per person, number and device', () => {
  it('starts only for a verified owner, and only once', async () => {
    const unverified = await owner(null);
    expect(await startTrial(unverified.userId, unverified.tenantId, device())).toEqual({ ok: false, reason: 'unverified' });

    const a = await owner(fresh());
    expect((await startTrial(a.userId, a.tenantId, device())).ok).toBe(true);
    expect(await status(a.tenantId)).toBe('trialing');
    expect(await startTrial(a.userId, a.tenantId, device())).toEqual({ ok: false, reason: 'not_pending' });

    // The same person's second workspace: no second trial.
    const second = await provisionTenant({ name: 'Second', slug: `trial-${run}-second`, ownerUserId: a.userId, trial: false });
    tenants.push(second.id);
    expect(await startTrial(a.userId, second.id, device())).toEqual({ ok: false, reason: 'used' });
    expect(await status(second.id)).toBe('pending');
  });

  it('a number that already had a trial can’t start another, even on a new account', async () => {
    const phone = fresh();
    const a = await owner(phone);
    expect((await startTrial(a.userId, a.tenantId, device())).ok).toBe(true);
    await prisma.user.update({ where: { id: a.userId }, data: { phoneNumber: fresh() } }); // number moved to another account
    const b = await owner(phone);
    expect(await startTrial(b.userId, b.tenantId, device())).toEqual({ ok: false, reason: 'phone_used' });
  });

  it('the same browser gets no automatic trial, and Kicko is asked to review', async () => {
    const shared = randomUUID();
    const a = await owner(fresh());
    expect((await startTrial(a.userId, a.tenantId, device(shared))).ok).toBe(true);
    const b = await owner(fresh());
    expect(await startTrial(b.userId, b.tenantId, device(shared))).toEqual({ ok: false, reason: 'device' });
    const review = await prisma.trialReview.findFirst({ where: { tenantId: b.tenantId } });
    expect(review).toMatchObject({ status: 'open', matchTenantId: a.tenantId, reason: 'Same browser as an earlier trial' });
  });

  it('a matching fingerprint only counts on the same public network', async () => {
    const fp = 'a'.repeat(64);
    const a = await owner(fresh());
    expect((await startTrial(a.userId, a.tenantId, { deviceId: randomUUID(), fingerprint: fp, ip: '49.37.120.5' })).ok).toBe(true);
    const elsewhere = await owner(fresh());
    expect((await startTrial(elsewhere.userId, elsewhere.tenantId, { deviceId: randomUUID(), fingerprint: fp, ip: '103.21.58.1' })).ok).toBe(true);
    const same = await owner(fresh());
    expect(await startTrial(same.userId, same.tenantId, { deviceId: randomUUID(), fingerprint: fp, ip: '49.37.120.5' })).toEqual({ ok: false, reason: 'device' });
  });
});

describe('sign-up checks', () => {
  it('refuses throwaway email domains, including subdomains', () => {
    expect(isDisposableEmail('someone@mailinator.com')).toBe(true);
    expect(isDisposableEmail('Someone@Mail.YOPmail.com')).toBe(true);
    expect(isDisposableEmail('owner@horizonoverseas.in')).toBe(false);
    expect(isDisposableEmail('owner@gmail.com')).toBe(false);
  });

  it('accepts Indian mobiles in any format, and refuses landlines and junk', () => {
    expect(parseMobile('98400 11223')).toBe('+919840011223');
    expect(parseMobile('+91-98400-11223')).toBe('+919840011223');
    expect(parseMobile('09840011223')).toBe('+919840011223');
    expect(() => parseMobile('044 2434 5678')).toThrow();
    expect(() => parseMobile('12345')).toThrow();
  });

  it('ignores local and private addresses for the network check', () => {
    expect(hashIp('::1')).toBeNull();
    expect(hashIp('192.168.1.4')).toBeNull();
    expect(hashIp('49.37.120.5')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('explains branch limits per plan', () => {
    expect(limitMessage('starter')).toBe('Starter includes 1 branch. Upgrade to Growth for up to 3.');
    expect(limitMessage('growth')).toBe('Growth includes 3 branches. Upgrade to Pro for unlimited branches.');
  });
});
