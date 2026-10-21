'use server';

import { headers } from 'next/headers';
import { formObject, run, type ActionResult } from '@/lib/action';
import { checkIn } from '@/server/checkins';
import { createLead } from '@/server/leads';
import { publicScope, rateLimit } from '@/server/public';
import { UserError } from '@/server/scope';

async function guard(slug: string, key: string, kind: string) {
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!rateLimit(`${kind}:${slug}:${ip}`, kind === 'kiosk' ? 30 : 6)) throw new UserError('Too many submissions. Please wait a minute.');
  const scope = await publicScope(slug, key);
  if (!scope) throw new UserError('This form link is no longer valid. Please contact the agency.');
  return scope;
}

export async function submitEnquiry(slug: string, key: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const raw = formObject(fd);
  // Honeypot: bots fill every field. Pretend success.
  if (raw.website) return { ok: true };
  return run(async () => {
    const scope = await guard(slug, key, 'form');
    await createLead(
      scope,
      {
        firstName: raw.firstName ?? '',
        lastName: raw.lastName,
        email: raw.email,
        phone: raw.phone,
        interestCountry: raw.interestCountry,
        interestCategory: (raw.interestCategory || undefined) as never,
        message: raw.message,
        source: 'WEB_FORM',
        waOptIn: raw.waOptIn === 'on',
      },
      { mergeDuplicates: true },
    );
  });
}

export async function submitCheckIn(slug: string, key: string, _: ActionResult | null, fd: FormData): Promise<ActionResult<{ ahead: number; returning: boolean }>> {
  const raw = formObject(fd);
  return run(async () => {
    const scope = await guard(slug, key, 'kiosk');
    const res = await checkIn(scope, { name: raw.name ?? '', phone: raw.phone ?? '', purpose: raw.purpose ?? '', waOptIn: raw.waOptIn === 'on' });
    return { ahead: res.ahead, returning: res.returning };
  });
}
