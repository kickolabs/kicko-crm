'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { APIError } from 'better-auth/api';
import { z } from 'zod';
import { formObject, run, type ActionResult } from '@/lib/action';
import { auth, getSession } from '@/lib/auth';
import { getTenantBySlug } from '@/lib/tenant';
import { acceptInvite, getInvite } from '@/server/team';
import { UserError } from '@/server/scope';

export async function acceptInviteAction(slug: string, token: string): Promise<ActionResult> {
  const res = await run(async () => {
    const session = await getSession();
    if (!session) throw new UserError('Sign in first');
    const tenant = await getTenantBySlug(slug);
    if (!tenant) throw new UserError('Workspace not found');
    await acceptInvite(tenant.id, token, session.user);
  });
  if (res.ok) redirect(`/${slug}`);
  return res;
}

const schema = z
  .object({
    name: z.string().trim().min(1, 'Your name is required').max(80),
    password: z.string().min(8, 'At least 8 characters').max(128),
    confirmPassword: z.string(),
  })
  .refine((x) => x.password === x.confirmPassword, { message: 'The passwords don’t match', path: ['confirmPassword'] });

/** New teammate: create their account with the invited email, then join. */
export async function inviteSignUpAction(slug: string, token: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const res = await run(async () => {
    const input = schema.parse(formObject(fd));
    const tenant = await getTenantBySlug(slug);
    const invite = tenant ? await getInvite(tenant.id, token) : null;
    if (!tenant || !invite) throw new UserError('This invite has expired');
    try {
      const { user } = await auth.api.signUpEmail({
        body: { name: input.name, email: invite.email, password: input.password },
        headers: await headers(),
      });
      await acceptInvite(tenant.id, token, { id: user.id, email: user.email });
    } catch (err) {
      if (err instanceof APIError && /already exists/i.test(String(err.body?.message ?? err.message))) {
        throw new UserError('You already have a Kicko account. Sign in, then open this link again.');
      }
      throw err;
    }
  });
  if (res.ok) redirect(`/${slug}`);
  return res;
}
