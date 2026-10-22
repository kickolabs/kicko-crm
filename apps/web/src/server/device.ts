import 'server-only';
import { randomUUID } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import type { Device } from './trial';

const COOKIE = 'kicko_did';

/**
 * The browser this request comes from: a long-lived first-party cookie (set here if
 * missing), the posted fingerprint and the client IP. Only call from a server action
 * or route handler (it may set a cookie).
 */
export async function currentDevice(fingerprint?: string | null): Promise<Device> {
  const jar = await cookies();
  let deviceId = jar.get(COOKIE)?.value ?? null;
  if (!deviceId || !/^[0-9a-f-]{36}$/.test(deviceId)) {
    deviceId = randomUUID();
    jar.set(COOKIE, deviceId, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 2 * 365 * 86400 });
  }
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const fp = fingerprint && /^[0-9a-f]{64}$/.test(fingerprint) ? fingerprint : null;
  return { deviceId, fingerprint: fp, ip };
}
