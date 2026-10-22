import 'server-only';
import { createHash } from 'node:crypto';
import { prisma, withTenant } from '@kicko/db';
import { TRIAL_DAYS } from '@kicko/db/provision';
import { audit } from './audit';

// One free trial per person, per verified mobile number and per device.
// Workspaces start "pending"; the trial starts when the owner verifies their mobile
// and nothing says they've had one before. A device that already used a trial gets
// no automatic trial: Kicko reviews it (and can grant one from /admin).

const YEAR = 365 * 86400_000;

export type Device = { deviceId: string | null; fingerprint: string | null; ip: string | null };

/** Loopback and private-network addresses say nothing about who is signing up (local development, proxies). */
const PRIVATE_IP = /^(::1?|::ffff:)?(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)|^::1?$|^f[cd][0-9a-f]{2}:|^fe80:/i;

export const hashIp = (ip: string | null) =>
  ip && !PRIVATE_IP.test(ip) ? createHash('sha256').update(`${process.env.BETTER_AUTH_SECRET}:ip:${ip}`).digest('hex').slice(0, 32) : null;

export type TrialResult =
  | { ok: true; trialEndsAt: Date }
  | { ok: false; reason: 'not_pending' | 'not_owner' | 'unverified' | 'used' | 'phone_used' | 'device' };

export const TRIAL_MESSAGE: Record<Exclude<TrialResult, { ok: true }>['reason'], string> = {
  not_pending: 'This workspace already has a plan or a trial.',
  not_owner: 'Only the workspace owner can start its free trial.',
  unverified: 'Verify your mobile number to start the free trial.',
  used: 'You’ve already used your free trial. Choose a plan to start using this workspace.',
  phone_used: 'This mobile number already used its free trial. Choose a plan to continue.',
  device: 'This device already used a free trial. Choose a plan, or contact Kicko support if this is a different agency.',
};

/** Can this person still get a trial? (For the banner: verify vs choose a plan.) */
export async function trialEligible(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { trialUsedAt: true } });
  return Boolean(u && !u.trialUsedAt);
}

export async function startTrial(userId: string, tenantId: string, device: Device): Promise<TrialResult> {
  const [user, owner, sub] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { phoneNumber: true, phoneNumberVerified: true, trialUsedAt: true } }),
    withTenant(tenantId, (tx) => tx.membership.findFirst({ where: { userId, role: 'OWNER', active: true } })),
    withTenant(tenantId, (tx) => tx.subscription.findUnique({ where: { tenantId } })),
  ]);
  if (!sub || sub.status !== 'pending') return { ok: false, reason: 'not_pending' };
  if (!owner) return { ok: false, reason: 'not_owner' };
  if (!user?.phoneNumberVerified || !user.phoneNumber) return { ok: false, reason: 'unverified' };
  if (user.trialUsedAt) return { ok: false, reason: 'used' };
  if (await prisma.trialClaim.findUnique({ where: { phone: user.phoneNumber } })) return { ok: false, reason: 'phone_used' };

  // Same browser (device cookie), or same fingerprint on the same network (a private
  // window or cleared cookies). A fingerprint alone is too common to act on.
  const ipHash = hashIp(device.ip);
  const since = new Date(Date.now() - YEAR);
  const seen = await prisma.trialClaim.findFirst({
    where: {
      createdAt: { gt: since },
      OR: [
        ...(device.deviceId ? [{ deviceId: device.deviceId }] : []),
        ...(device.fingerprint && ipHash ? [{ fingerprint: device.fingerprint, ipHash }] : []),
      ],
    },
  });
  if (seen && (device.deviceId || (device.fingerprint && ipHash))) {
    const open = await prisma.trialReview.findFirst({ where: { tenantId, status: 'open' } });
    if (!open) {
      await prisma.trialReview.create({
        data: { tenantId, userId, matchTenantId: seen.tenantId, reason: seen.deviceId && seen.deviceId === device.deviceId ? 'Same browser as an earlier trial' : 'Same device and network as an earlier trial' },
      });
    }
    return { ok: false, reason: 'device' };
  }

  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86400_000);
  await withTenant(tenantId, async (tx) => {
    await tx.subscription.update({ where: { tenantId }, data: { plan: 'pro', seats: 10, status: 'trialing', statusSince: new Date(), trialEndsAt } });
    await tx.user.update({ where: { id: userId }, data: { trialUsedAt: new Date() } });
    await tx.trialClaim.create({ data: { phone: user.phoneNumber!, userId, tenantId, deviceId: device.deviceId, fingerprint: device.fingerprint, ipHash } });
  });
  await audit({ tenantId, actorId: userId }, 'billing.trial_started', `Started the ${TRIAL_DAYS}-day free trial`);
  return { ok: true, trialEndsAt };
}

/** Admin console: how many trials came from the same network recently (a flag, never a block). */
export async function sameNetworkTrials(tenantId: string) {
  const claim = await prisma.trialClaim.findFirst({ where: { tenantId } });
  if (!claim?.ipHash) return 0;
  return prisma.trialClaim.count({ where: { ipHash: claim.ipHash, createdAt: { gt: new Date(Date.now() - 30 * 86400_000) } } });
}
