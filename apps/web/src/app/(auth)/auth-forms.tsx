'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ActionForm, FormField, SubmitButton } from '@/components/forms';
import { Input } from '@/components/ui';
import { signInAction, signUpAction, verifySecondFactorAction } from './actions';

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

export function SecondFactorForm({ next }: { next: string }) {
  const [mode, setMode] = useState<'totp' | 'backup'>('totp');
  return (
    <ActionForm action={verifySecondFactorAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="mode" value={mode} />
      {mode === 'totp' ? (
        <FormField label="Code" name="code">
          <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} placeholder="123 456" autoFocus className="text-center text-2xl tracking-[0.3em]" />
        </FormField>
      ) : (
        <FormField label="Backup code" name="code" hint="One of the codes you saved when you set up two-step sign-in. Each works once.">
          <Input id="code" name="code" autoComplete="off" autoFocus />
        </FormField>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="trust" className="size-4 accent-ink" />
        Trust this browser for 30 days
      </label>
      <SubmitButton size="lg" className="w-full">Verify</SubmitButton>
      <button type="button" onClick={() => setMode(mode === 'totp' ? 'backup' : 'totp')} className="text-sm font-semibold text-muted hover:text-ink">
        {mode === 'totp' ? 'Lost your phone? Use a backup code' : 'Use the authenticator app instead'}
      </button>
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
      <p className="text-center text-xs text-muted">
        By creating a workspace you agree to the <Link href="/terms" className="underline">Terms</Link>, <Link href="/privacy" className="underline">Privacy Policy</Link> and{' '}
        <Link href="/dpa" className="underline">Data Processing Agreement</Link>.
      </p>
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
