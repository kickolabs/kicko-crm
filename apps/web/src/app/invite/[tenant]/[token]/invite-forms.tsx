'use client';

import Link from 'next/link';
import { ActionButton, ActionForm, FormField, SubmitButton } from '@/components/forms';
import { Input, buttonCls } from '@/components/ui';
import { signOutAction } from '../../../(auth)/actions';
import { acceptInviteAction, inviteSignUpAction } from './actions';

export function AcceptInvite({ slug, token, signedInAs, matches }: { slug: string; token: string; signedInAs: string; matches: boolean }) {
  if (!matches) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-[12px] bg-warn-bg px-4 py-3 text-sm text-warn-ink">
          You're signed in as <strong>{signedInAs}</strong>, but this invite is for a different email.
        </p>
        <form action={signOutAction}>
          <button className={buttonCls('primary', 'md', 'w-full')}>Sign out and switch account</button>
        </form>
      </div>
    );
  }
  return (
    <ActionButton action={() => acceptInviteAction(slug, token)} variant="primary" size="md" className="w-full">
      Accept & open workspace
    </ActionButton>
  );
}

export function InviteSignUp({ slug, token, email }: { slug: string; token: string; email: string }) {
  return (
    <ActionForm action={inviteSignUpAction.bind(null, slug, token)} className="flex flex-col gap-4">
      <FormField label="Email" name="email"><Input name="email" value={email} readOnly disabled /></FormField>
      <FormField label="Your name" name="name"><Input name="name" autoComplete="name" required autoFocus /></FormField>
      <FormField label="Choose a password" name="password" hint="At least 8 characters">
        <Input name="password" type="password" autoComplete="new-password" required />
      </FormField>
      <SubmitButton size="lg" className="w-full">Join the team</SubmitButton>
      <p className="text-center text-sm text-muted">
        Already have an account?{' '}
        <Link href={`/login?next=/invite/${slug}/${token}`} className="font-semibold text-ink underline underline-offset-4">Sign in</Link>
      </p>
    </ActionForm>
  );
}
