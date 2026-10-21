'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Lead, VisaProduct } from '@kicko/db';
import { ActionForm, FormBanner, FormField, SubmitButton, useFieldError } from '@/components/forms';
import { Input, Select, Textarea } from '@/components/ui';
import { CATEGORY_LABEL, CATEGORIES, COUNTRIES, LEAD_SOURCE_LABEL, LEAD_SOURCES } from '@/lib/constants';
import { createLeadAction, updateLeadAction } from '../actions';

type Member = { userId: string; name: string };
type Product = Pick<VisaProduct, 'id' | 'name' | 'country' | 'category'>;

/** Duplicate warning: when the server flags a match, the next submit creates anyway. */
function DuplicateNotice() {
  const flag = useFieldError('allowDuplicate');
  const href = useFieldError('duplicateHref');
  if (!flag) return null;
  return (
    <>
      <input type="hidden" name="allowDuplicate" value="1" />
      {href && (
        <FormBanner tone="warn">
          <Link href={href} className="font-semibold underline underline-offset-4">
            Open the existing record
          </Link>{' '}
          or press <strong>Create lead</strong> again to add a new one anyway.
        </FormBanner>
      )}
    </>
  );
}

export function LeadFields({
  lead,
  products,
  team,
  autoAssign,
}: {
  lead?: Lead;
  products: Product[];
  team: Member[];
  autoAssign: boolean;
}) {
  const [category, setCategory] = useState<string>(lead?.interestCategory ?? '');
  const [country, setCountry] = useState<string>(lead?.interestCountry ?? '');
  const options = products.filter((p) => (!category || p.category === category) && (!country || p.country === country));
  return (
    <div className="grid gap-3.5 sm:grid-cols-2">
      <FormField label="First name" name="firstName">
        <Input name="firstName" defaultValue={lead?.firstName} required autoFocus={!lead} />
      </FormField>
      <FormField label="Last name" name="lastName">
        <Input name="lastName" defaultValue={lead?.lastName ?? ''} />
      </FormField>
      <FormField label="Phone / WhatsApp" name="phone">
        <Input name="phone" type="tel" defaultValue={lead?.phone ?? ''} placeholder="+91 98765 43210" />
      </FormField>
      <FormField label="Email" name="email">
        <Input name="email" type="email" defaultValue={lead?.email ?? ''} />
      </FormField>
      <FormField label="Interested in" name="interestCategory">
        <Select name="interestCategory" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Not sure yet</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Country" name="interestCountry">
        <Select name="interestCountry" value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">Any</option>
          {Object.entries(COUNTRIES).map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Visa product" name="productId" className="sm:col-span-2">
        <Select name="productId" defaultValue={lead?.productId ?? ''}>
          <option value="">Decide later</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {COUNTRIES[p.country] ?? p.country} · {p.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Source" name="source">
        <Select name="source" defaultValue={lead?.source ?? 'CALL'}>
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>
              {LEAD_SOURCE_LABEL[s]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Owner" name="ownerId" hint={!lead && autoAssign ? 'Leave empty to auto-assign' : undefined}>
        <Select name="ownerId" defaultValue={lead?.ownerId ?? ''}>
          <option value="">{autoAssign && !lead ? 'Auto-assign' : 'Unassigned'}</option>
          {team.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Enquiry / notes" name="message" className="sm:col-span-2">
        <Textarea name="message" defaultValue={lead?.message ?? ''} placeholder="What are they looking for? Scores, budget, intake…" />
      </FormField>
      {!lead && (
        <label className="flex items-center gap-2 text-sm font-medium sm:col-span-2">
          <input type="checkbox" name="waOptIn" className="h-4 w-4 accent-[#121417]" />
          They agreed to receive WhatsApp updates
        </label>
      )}
    </div>
  );
}

export function NewLeadForm(props: { slug: string; products: Product[]; team: Member[]; autoAssign: boolean }) {
  return (
    <ActionForm action={createLeadAction.bind(null, props.slug)} className="flex flex-col gap-4">
      <DuplicateNotice />
      <LeadFields products={props.products} team={props.team} autoAssign={props.autoAssign} />
      <div className="flex justify-end">
        <SubmitButton>Create lead</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function EditLeadForm(props: { slug: string; lead: Lead; products: Product[]; team: Member[]; onDone?: () => void }) {
  return (
    <ActionForm action={updateLeadAction.bind(null, props.slug, props.lead.id)} onSuccess={props.onDone} className="flex flex-col gap-4">
      <LeadFields lead={props.lead} products={props.products} team={props.team} autoAssign={false} />
      <div className="flex justify-end">
        <SubmitButton>Save</SubmitButton>
      </div>
    </ActionForm>
  );
}
