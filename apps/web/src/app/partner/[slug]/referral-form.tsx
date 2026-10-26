'use client';

import { Combobox } from '@/components/combobox';
import { aliasesOf } from '@/lib/countries';
import { useState } from 'react';
import { ActionForm, FormBanner, FormField, SubmitButton } from '@/components/forms';
import { Input, Select, Textarea } from '@/components/ui';
import type { ReferralResult } from '@/server/sub-agents';
import { referAction } from './actions';

export function ReferralForm({ slug, countries, categories }: { slug: string; countries: [string, string][]; categories: [string, string][] }) {
  const [result, setResult] = useState<ReferralResult | null>(null);
  const [round, setRound] = useState(0); // remount = a fresh, empty form after a successful referral
  return (
    <div className="flex flex-col gap-3">
      {result?.status === 'created' && <FormBanner tone="ok">Thanks! Referral {result.ref} received. A counsellor will contact them soon.</FormBanner>}
      {result?.status === 'exists' && (
        <FormBanner tone="warn">This person is already registered with the agency, so it isn't recorded as your referral. If you think that's wrong, contact the agency.</FormBanner>
      )}
      <ActionForm
        key={round}
        action={referAction.bind(null, slug)}
        onSuccess={(r) => {
          const d = r.ok ? (r.data as ReferralResult) : null;
          setResult(d);
          if (d?.status === 'created') setRound((n) => n + 1);
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="First name" name="firstName"><Input name="firstName" required /></FormField>
          <FormField label="Last name" name="lastName"><Input name="lastName" /></FormField>
          <FormField label="Phone (WhatsApp)" name="phone"><Input name="phone" type="tel" placeholder="+91 98765 43210" required /></FormField>
          <FormField label="Email" name="email"><Input name="email" type="email" /></FormField>
          <FormField label="Destination" name="interestCountry">
            <Combobox name="interestCountry" options={countries.map(([key, name]) => ({ key, name, search: aliasesOf(key).join(' ') }))} emptyLabel="Not sure yet" placeholder="Type a country" />
          </FormField>
          <FormField label="Looking to" name="interestCategory">
            <Select name="interestCategory" defaultValue=""><option value="">Not sure yet</option>{categories.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
          </FormField>
        </div>
        <FormField label="Notes for the counsellor" name="message"><Textarea name="message" className="min-h-20" placeholder="e.g. B.Tech 2024, IELTS 7, wants Canada for Sep 2027" /></FormField>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="consent" className="mt-0.5 h-4 w-4 accent-ink" />
          <span>The client agreed to be contacted by the agency.</span>
        </label>
        <div><SubmitButton>Refer client</SubmitButton></div>
      </ActionForm>
    </div>
  );
}
