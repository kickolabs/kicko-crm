'use client';

import clsx from 'clsx';
import { useActionState, useEffect, useState } from 'react';
import { FormBanner, SubmitButton } from '@/components/forms';
import { LogoMark } from '@/components/logo';
import { submitCheckIn } from '../../actions';

const PURPOSES = ['Study abroad', 'PR / migration', 'Work visa', 'Visit visa', 'Spouse / family', 'Document submission', 'Meeting my counsellor'];

const big =
  'h-16 w-full rounded-[18px] bg-card px-5 text-xl font-semibold shadow-[inset_0_0_0_1.5px_var(--color-line-2)] outline-none focus:shadow-[inset_0_0_0_3px_var(--color-ink)]';

/** Reception tablet: big touch targets, resets itself after each visitor. */
export function KioskForm({ slug, formKey, agency }: { slug: string; formKey: string; agency: string }) {
  const [round, setRound] = useState(0);
  return <Inner key={round} slug={slug} formKey={formKey} agency={agency} onReset={() => setRound((r) => r + 1)} />;
}

function Inner({ slug, formKey, agency, onReset }: { slug: string; formKey: string; agency: string; onReset: () => void }) {
  const [state, action] = useActionState(submitCheckIn.bind(null, slug, formKey), null);
  const [purpose, setPurpose] = useState('');

  useEffect(() => {
    if (state?.ok) {
      const t = setTimeout(onReset, 9000);
      return () => clearTimeout(t);
    }
  }, [state, onReset]);

  if (state?.ok && state.data) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-ink px-6 text-center text-paper">
        <span className="live-dot h-4 w-4 rounded-full bg-lime" />
        <h1 className="text-[44px] leading-tight font-extrabold tracking-[-0.04em] sm:text-[64px]">
          {state.data.returning ? 'Welcome back.' : 'Thanks, you’re checked in.'}
        </h1>
        <p className="text-xl text-[#C4CAD2]">
          {state.data.ahead === 0 ? 'You’re next. Someone will be with you shortly.' : `${state.data.ahead} ${state.data.ahead === 1 ? 'person is' : 'people are'} ahead of you. Please take a seat.`}
        </p>
        <button type="button" onClick={onReset} className="mt-6 rounded-full px-6 py-3 text-sm font-semibold text-[#A9AFB7] underline underline-offset-4">
          Next visitor
        </button>
      </div>
    );
  }

  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return (
    <div className="dotgrid flex min-h-dvh flex-col items-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-8">
        <div className="flex items-center gap-3">
          <LogoMark size={40} />
          <span className="text-lg font-bold">{agency}</span>
        </div>
        <h1 className="text-[44px] leading-[1.02] font-extrabold tracking-[-0.045em] sm:text-[60px]">Welcome. Let us know you’re here.</h1>
        <form action={action} className="flex flex-col gap-5">
          {state && !state.ok && <FormBanner tone="error">{state.error}</FormBanner>}
          <label className="flex flex-col gap-2">
            <span className="text-base font-bold">Your name</span>
            <input name="name" className={big} autoComplete="off" required />
            {fe.name && <span className="text-sm font-medium text-danger">{fe.name}</span>}
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-base font-bold">Mobile number</span>
            <input name="phone" type="tel" inputMode="tel" className={big} autoComplete="off" required />
            {fe.phone && <span className="text-sm font-medium text-danger">{fe.phone}</span>}
          </label>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-base font-bold">What brings you in today?</legend>
            <input type="hidden" name="purpose" value={purpose} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {PURPOSES.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={purpose === p}
                  onClick={() => setPurpose(p)}
                  className={clsx('min-h-16 rounded-[18px] px-4 py-3 text-left text-base font-semibold transition-colors', purpose === p ? 'bg-ink text-paper' : 'bg-card shadow-[inset_0_0_0_1.5px_var(--color-line-2)]')}
                >
                  {p}
                </button>
              ))}
            </div>
            {fe.purpose && <span className="text-sm font-medium text-danger">{fe.purpose}</span>}
          </fieldset>
          <label className="flex items-center gap-3 text-base font-semibold">
            <input type="checkbox" name="waOptIn" defaultChecked className="h-6 w-6 accent-[#121417]" />
            Send me updates on WhatsApp
          </label>
          <SubmitButton size="lg" variant="lime" className="h-16 w-full rounded-[18px] text-lg">
            Check in
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
