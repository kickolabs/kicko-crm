'use client';

import clsx from 'clsx';
import { useActionState, useState } from 'react';
import { FormBanner, SubmitButton } from '@/components/forms';
import { Field, Input } from '@/components/ui';
import { requestLinkAction } from '../actions';

export function LoginForm({ slug, whatsapp }: { slug: string; whatsapp: boolean }) {
  const [state, action] = useActionState(requestLinkAction.bind(null, slug), null);
  const [via, setVia] = useState<'whatsapp' | 'email'>(whatsapp ? 'whatsapp' : 'email');
  if (state?.ok) {
    const wa = state.data?.via === 'whatsapp';
    return (
      <div role="status" className="flex flex-col gap-3 rounded-[16px] bg-lime-soft p-5">
        <p className="font-semibold">{wa ? 'Check WhatsApp.' : 'Check your inbox.'}</p>
        <p className="text-sm text-ink-2">
          {wa ? 'If that number is on file, a sign-in link is on its way on WhatsApp.' : 'If that email is on file, a sign-in link is on its way.'} It expires in 1 hour.
        </p>
        {state.data?.devLink && (
          <a href={state.data.devLink} className="text-xs font-semibold break-all underline underline-offset-4">
            Development only: open the link directly
          </a>
        )}
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      {whatsapp && (
        <div role="tablist" aria-label="Send link via" className="flex gap-1 rounded-full bg-paper-3 p-1">
          {(['whatsapp', 'email'] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={via === v} onClick={() => setVia(v)} className={clsx('flex-1 rounded-full py-2 text-sm font-semibold', via === v ? 'bg-ink text-paper' : 'text-muted')}>
              {v === 'whatsapp' ? 'WhatsApp' : 'Email'}
            </button>
          ))}
        </div>
      )}
      {state && !state.ok && <FormBanner tone="error">{state.error}</FormBanner>}
      {via === 'whatsapp' ? (
        <Field label="Mobile number (WhatsApp)" name="phone">
          <Input name="phone" type="tel" autoComplete="tel" placeholder="+91 98765 43210" required autoFocus />
        </Field>
      ) : (
        <Field label="Email" name="email">
          <Input name="email" type="email" autoComplete="email" required autoFocus />
        </Field>
      )}
      <SubmitButton size="lg" className="w-full">{via === 'whatsapp' ? 'Send me a link on WhatsApp' : 'Email me a sign-in link'}</SubmitButton>
    </form>
  );
}
