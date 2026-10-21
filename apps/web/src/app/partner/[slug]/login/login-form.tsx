'use client';

import { useActionState } from 'react';
import { FormBanner, SubmitButton } from '@/components/forms';
import { Field, Input } from '@/components/ui';
import { requestPartnerLinkAction } from '../actions';

export function PartnerLoginForm({ slug }: { slug: string }) {
  const [state, action] = useActionState(requestPartnerLinkAction.bind(null, slug), null);
  if (state?.ok) {
    return (
      <div role="status" className="flex flex-col gap-3 rounded-[16px] bg-lime-soft p-5">
        <p className="font-semibold">Check your inbox.</p>
        <p className="text-sm text-ink-2">If that email belongs to a registered partner, a sign-in link is on its way. It expires in 1 hour.</p>
        {state.data?.devLink && (
          <a href={state.data.devLink} className="text-xs font-semibold break-all underline underline-offset-4">Development only: open the link directly</a>
        )}
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      {state && !state.ok && <FormBanner tone="error">{state.error}</FormBanner>}
      <Field label="Email" name="email">
        <Input name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <SubmitButton size="lg" className="w-full">Email me a sign-in link</SubmitButton>
    </form>
  );
}
