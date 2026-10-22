'use client';

import { useState } from 'react';
import { ActionForm, FormField, SubmitButton } from '@/components/forms';
import { DeviceFingerprint } from '@/components/device-fingerprint';
import { Input } from '@/components/ui';
import { sendMobileCodeAction, startTrialAction, verifyMobileAction } from '../actions';

export function MobileForm({ slug }: { slug: string }) {
  return (
    <ActionForm action={sendMobileCodeAction.bind(null, slug)} className="flex flex-col gap-4">
      <FormField label="Mobile number" name="mobile">
        <Input name="mobile" type="tel" inputMode="tel" autoComplete="tel" placeholder="98400 11223" required autoFocus />
      </FormField>
      <SubmitButton size="lg" className="w-full">Send code</SubmitButton>
    </ActionForm>
  );
}

export function CodeForm({ slug, phone }: { slug: string; phone: string }) {
  const [changing, setChanging] = useState(false);
  if (changing) return <MobileForm slug={slug} />;
  return (
    <div className="flex flex-col gap-4">
      <ActionForm action={verifyMobileAction.bind(null, slug)} className="flex flex-col gap-4">
        <DeviceFingerprint />
        <FormField label="Code" name="code">
          <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} placeholder="123 456" required autoFocus className="text-center text-2xl tracking-[0.3em]" />
        </FormField>
        <SubmitButton size="lg" className="w-full">Verify &amp; start free trial</SubmitButton>
      </ActionForm>
      <div className="flex items-center justify-center gap-5 text-sm">
        <ActionForm action={sendMobileCodeAction.bind(null, slug)}>
          <input type="hidden" name="mobile" value={phone} />
          <button type="submit" className="font-semibold text-muted hover:text-ink">Resend code</button>
        </ActionForm>
        <button type="button" onClick={() => setChanging(true)} className="font-semibold text-muted hover:text-ink">Change number</button>
      </div>
    </div>
  );
}

export function StartTrialForm({ slug }: { slug: string }) {
  return (
    <ActionForm action={startTrialAction.bind(null, slug)}>
      <DeviceFingerprint />
      <SubmitButton size="lg" className="w-full">Start my free trial</SubmitButton>
    </ActionForm>
  );
}
