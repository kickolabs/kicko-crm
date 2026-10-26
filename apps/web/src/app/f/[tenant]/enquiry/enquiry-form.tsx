'use client';

import { Combobox } from '@/components/combobox';
import { aliasesOf } from '@/lib/countries';
import { useActionState } from 'react';
import { FormBanner, SubmitButton } from '@/components/forms';
import { Field, Input, Select, Textarea } from '@/components/ui';
import { CATEGORY_LABEL, CATEGORIES } from '@/lib/constants';
import { submitEnquiry } from '../../actions';

export function EnquiryForm({ slug, formKey, countries }: { slug: string; formKey: string; countries: { offered: [string, string][]; others: [string, string][] } }) {
  const [state, action] = useActionState(submitEnquiry.bind(null, slug, formKey), null);
  if (state?.ok) {
    return (
      <div role="status" className="pop-in flex flex-col items-start gap-3 rounded-[16px] bg-lime p-6">
        <h2 className="text-xl font-extrabold tracking-tight">Thanks, we've got it.</h2>
        <p className="text-sm">A counsellor will reach out shortly on the phone number or email you shared.</p>
      </div>
    );
  }
  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state && !state.ok && <FormBanner tone="error">{state.error}</FormBanner>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" name="firstName" error={fe.firstName}><Input name="firstName" autoComplete="given-name" required /></Field>
        <Field label="Last name" name="lastName"><Input name="lastName" autoComplete="family-name" /></Field>
        <Field label="Phone / WhatsApp" name="phone" error={fe.phone}><Input name="phone" type="tel" autoComplete="tel" required /></Field>
        <Field label="Email" name="email" error={fe.email}><Input name="email" type="email" autoComplete="email" /></Field>
        <Field label="I'm interested in" name="interestCategory">
          <Select name="interestCategory" defaultValue="">
            <option value="">Not sure yet</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </Select>
        </Field>
        <Field label="Country" name="interestCountry">
          <Combobox
            name="interestCountry"
            emptyLabel="Not sure yet"
            placeholder="Type a country"
            groupOrder={['Popular']}
            options={[
              ...countries.offered.map(([key, name]) => ({ key, name, group: 'Popular', search: aliasesOf(key).join(' ') })),
              ...countries.others.map(([key, name]) => ({ key, name, group: countries.offered.length ? 'All countries' : undefined, search: aliasesOf(key).join(' ') })),
            ]}
          />
        </Field>
      </div>
      <Field label="Anything we should know?" name="message">
        <Textarea name="message" placeholder="Course, test scores, budget, preferred intake…" />
      </Field>
      <label className="flex items-start gap-2.5 text-sm text-ink-2">
        <input type="checkbox" name="waOptIn" defaultChecked className="mt-0.5 h-4 w-4 accent-[#121417]" />
        Send me updates about my enquiry on WhatsApp
      </label>
      {/* Honeypot, hidden from people */}
      <div aria-hidden="true" className="absolute -left-[9999px]">
        <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <SubmitButton size="lg" className="w-full">Send enquiry</SubmitButton>
      <p className="text-center text-[11px] text-muted">By submitting you agree to be contacted about your enquiry.</p>
    </form>
  );
}
