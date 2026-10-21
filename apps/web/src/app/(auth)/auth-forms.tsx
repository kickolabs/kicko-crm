'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ActionForm, FormField, SubmitButton } from '@/components/forms';
import { Input } from '@/components/ui';
import { signInAction, signUpAction } from './actions';

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export function SignInForm({ next }: { next?: string }) {
  return (
    <ActionForm action={signInAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next ?? ''} />
      <FormField label="Work email" name="email">
        <Input name="email" type="email" autoComplete="email" required autoFocus />
      </FormField>
      <FormField label="Password" name="password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </FormField>
      <SubmitButton size="lg" className="mt-2 w-full">
        Sign in
      </SubmitButton>
      <p className="text-center text-sm text-muted">
        New agency?{' '}
        <Link href="/signup" className="font-semibold text-ink underline underline-offset-4">
          Create a workspace
        </Link>
      </p>
    </ActionForm>
  );
}

export function SignUpForm({ signedInAs }: { signedInAs?: string }) {
  const [agency, setAgency] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const shownSlug = slugTouched ? slug : slugify(agency);

  return (
    <ActionForm action={signUpAction} className="flex flex-col gap-4">
      {!signedInAs && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Your name" name="name">
              <Input name="name" autoComplete="name" required autoFocus />
            </FormField>
            <FormField label="Work email" name="email">
              <Input name="email" type="email" autoComplete="email" required />
            </FormField>
          </div>
          <FormField label="Password" name="password" hint="At least 8 characters">
            <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
          </FormField>
          <div className="my-1 h-px bg-line" />
        </>
      )}
      <FormField label="Agency name" name="agencyName">
        <Input name="agencyName" value={agency} onChange={(e) => setAgency(e.target.value)} placeholder="e.g. Horizon Overseas Consultants" required autoFocus={Boolean(signedInAs)} />
      </FormField>
      <FormField label="Workspace address" name="slug" hint="Your team signs in here. You can't change it later.">
        <div className="flex items-center rounded-[11px] bg-card shadow-[inset_0_0_0_1px_var(--color-line-2)] focus-within:shadow-[inset_0_0_0_2px_var(--color-ink)]">
          <span className="pl-3 text-sm text-muted select-none">kicko.app/</span>
          <input
            id="slug"
            name="slug"
            value={shownSlug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(slugify(e.target.value));
            }}
            className="h-10 min-w-0 flex-1 bg-transparent pr-3 text-sm font-semibold outline-none"
            required
          />
        </div>
      </FormField>
      <SubmitButton size="lg" className="mt-2 w-full">
        {signedInAs ? 'Create workspace' : 'Create account & workspace'}
      </SubmitButton>
      {!signedInAs && (
        <p className="text-center text-sm text-muted">
          Already on Kicko?{' '}
          <Link href="/login" className="font-semibold text-ink underline underline-offset-4">
            Sign in
          </Link>
        </p>
      )}
    </ActionForm>
  );
}
