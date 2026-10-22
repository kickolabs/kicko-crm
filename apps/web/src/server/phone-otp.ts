import 'server-only';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma, prisma } from '@kicko/db';
import { otp } from '@/integrations/core/platform';
import { normalizePhone } from '@/lib/phone';
import { UserError } from './scope';

// Verify an owner's mobile with a 6-digit code. Codes live in the auth library's
// Verification table (hashed), expire in 10 minutes and allow 3 tries; at most 3
// codes per 10 minutes per account.

const TTL_MS = 10 * 60_000;
const MAX_SENDS = 3;
const MAX_TRIES = 3;

const id = (userId: string) => `phone-otp:${userId}`;
const hash = (code: string) => createHash('sha256').update(`${process.env.BETTER_AUTH_SECRET}:${code}`).digest('hex');

// `shown`: the code itself, kept only in sandbox (no SMS account) so the screen can display it.
type Pending = { phone: string; hash: string; tries: number; shown?: string };

/** Indian numbers by default; anything else must start with +country code. */
export function parseMobile(raw: string) {
  const phone = normalizePhone(raw, 'IN');
  if (!phone || !/^\+\d{10,15}$/.test(phone) || (phone.startsWith('+91') && !/^\+91[6-9]\d{9}$/.test(phone))) {
    throw new UserError('Enter a valid mobile number, e.g. 98400 11223');
  }
  return phone;
}

/** The sandbox shows the code on screen. Never in production unless explicitly allowed (tests). */
export function sandboxCodesShown() {
  return otp().sandbox && (process.env.NODE_ENV !== 'production' || process.env.OTP_SANDBOX === '1');
}

export async function sendCode(userId: string, rawPhone: string) {
  const phone = parseMobile(rawPhone);
  const taken = await prisma.user.findFirst({ where: { phoneNumber: phone, id: { not: userId } }, select: { id: true } });
  if (taken) throw new UserError('This mobile number is already used by another Kicko account.');
  const recent = await prisma.verification.count({ where: { identifier: id(userId), createdAt: { gt: new Date(Date.now() - TTL_MS) } } });
  if (recent >= MAX_SENDS) throw new UserError('Too many codes sent. Wait a few minutes, then try again.');
  const sender = otp();
  if (sender.sandbox && !sandboxCodesShown()) throw new UserError("Mobile verification isn't set up yet. Please contact Kicko support.");

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const value: Pending = { phone, hash: hash(code), tries: 0, ...(sender.sandbox ? { shown: code } : {}) };
  await prisma.verification.create({ data: { id: randomUUID(), identifier: id(userId), value: JSON.stringify(value), expiresAt: new Date(Date.now() + TTL_MS) } });
  await sender.send(phone, code);
  return { phone, sandboxCode: sender.sandbox ? code : null };
}

/** The code waiting to be entered, if any: where it went (and, in sandbox, the code). */
export async function pendingCode(userId: string) {
  const row = await prisma.verification.findFirst({ where: { identifier: id(userId), expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
  if (!row) return null;
  const p = JSON.parse(row.value) as Pending;
  return { phone: p.phone, sandboxCode: p.shown ?? null };
}

/** Checks the latest code; on success the number is saved on the account as verified. */
export async function verifyCode(userId: string, rawCode: string) {
  const code = rawCode.replace(/\D/g, '');
  const row = await prisma.verification.findFirst({ where: { identifier: id(userId), expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
  if (!row) throw new UserError('That code has expired. Send a new one.');
  const p = JSON.parse(row.value) as Pending;
  if (p.tries >= MAX_TRIES) throw new UserError('Too many wrong tries. Send a new code.');
  const ok = code.length === 6 && timingSafeEqual(Buffer.from(hash(code)), Buffer.from(p.hash));
  if (!ok) {
    await prisma.verification.update({ where: { id: row.id }, data: { value: JSON.stringify({ ...p, tries: p.tries + 1 }) } });
    throw new UserError(p.tries + 1 >= MAX_TRIES ? 'That code isn’t right. Send a new code.' : 'That code isn’t right. Check the SMS and try again.');
  }
  try {
    await prisma.user.update({ where: { id: userId }, data: { phoneNumber: p.phone, phoneNumberVerified: true } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new UserError('This mobile number is already used by another Kicko account.');
    throw err;
  }
  await prisma.verification.deleteMany({ where: { identifier: id(userId) } });
  return p.phone;
}
