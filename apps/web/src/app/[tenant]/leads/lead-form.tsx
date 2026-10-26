'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Lead, VisaProduct } from '@kicko/db';
import { ActionForm, FormBanner, FormField, SubmitButton, useFieldError } from '@/components/forms';
import { PackFields } from '@/components/pack-fields';
import { Input, Select, Textarea } from '@/components/ui';
import { LEAD_SOURCE_LABEL, LEAD_SOURCES } from '@/lib/constants';
import { countryName } from '@/lib/countries';
import type { PackValues } from '@/lib/pack-fields';
import type { PackFormProps } from '@/server/library';
import { createLeadAction, updateLeadAction } from '../actions';
import { PathwayInfo } from './pathway-info';

type Member = { userId: string; name: string };
export type LeadProduct = Pick<VisaProduct, 'id' | 'name' | 'country' | 'category' | 'info'>;

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

/**
 * Destination → visa type → pathway. Countries come from the pack library (every country);
 * the ones the agency has workflows for are listed first. Changing the country clears a
 * pathway that no longer fits; the server checks the same thing.
 */
function DestinationFields({ lead, products, form, slug }: { lead?: Lead; products: LeadProduct[]; form: PackFormProps; slug: string }) {
  const [country, setCountry] = useState<string>(lead?.interestCountry ?? '');
  const [category, setCategory] = useState<string>(lead?.interestCategory ?? '');
  const [productId, setProductId] = useState<string>(lead?.productId ?? '');
  const offered = new Set(products.map((p) => p.country));
  const countries = form.regionType ? (form.lookups[form.regionType] ?? []) : [];
  const ours = countries.filter((c) => offered.has(c.key));
  const regions = new Map<string, typeof countries>();
  for (const c of countries) if (!offered.has(c.key)) regions.set(c.group ?? 'Other', [...(regions.get(c.group ?? 'Other') ?? []), c]);
  const options = products.filter((p) => (!category || p.category === category) && (!country || p.country === country));
  const selected = products.find((p) => p.id === productId);
  const categories = Object.entries(form.categories);
  const library = country ? (form.pathwayCount[country] ?? 0) : 0;
  return (
    <>
      <FormField label="Country" name="interestCountry">
        <Select
          name="interestCountry"
          value={country}
          onChange={(e) => {
            setCountry(e.target.value);
            if (selected && e.target.value && selected.country !== e.target.value) setProductId('');
          }}
        >
          <option value="">Any</option>
          {ours.length > 0 && (
            <optgroup label="Your destinations">
              {ours.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
            </optgroup>
          )}
          {[...regions.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([region, list]) => (
            <optgroup key={region} label={region}>
              {list.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
            </optgroup>
          ))}
        </Select>
      </FormField>
      <FormField label="Interested in" name="interestCategory">
        <Select
          name="interestCategory"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            if (selected && e.target.value && selected.category !== e.target.value) setProductId('');
          }}
        >
          <option value="">Not sure yet</option>
          {categories.map(([c, label]) => <option key={c} value={c}>{label}</option>)}
        </Select>
      </FormField>
      <FormField label="Visa product" name="productId" className="sm:col-span-2" hint={country && !options.length ? undefined : 'The visa pathway this lead is most likely to take'}>
        <Select name="productId" value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Decide later</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {countryName(p.country)} · {p.name}
            </option>
          ))}
        </Select>
      </FormField>
      {country && !options.length && (
        <p className="-mt-2 text-xs text-muted sm:col-span-2">
          No {form.labels.workflow?.toLowerCase() ?? 'workflow'} for {countryName(country)}
          {category ? ` (${form.categories[category]})` : ''} yet.{' '}
          {library > 0 ? `The library has ${library} pathway${library > 1 ? 's' : ''} for it: ` : ''}
          <Link href={`/${slug}/settings?tab=workflows&country=${country}`} className="font-semibold text-ink underline underline-offset-4">
            add one in Settings
          </Link>
          . You can save the lead now and pick it later.
        </p>
      )}
      {selected && <PathwayInfo info={selected.info} className="sm:col-span-2" />}
    </>
  );
}

export function LeadFields({
  lead,
  products,
  team,
  autoAssign,
  form,
  slug,
}: {
  lead?: Lead;
  products: LeadProduct[];
  team: Member[];
  autoAssign: boolean;
  form: PackFormProps;
  slug: string;
}) {
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
      <DestinationFields lead={lead} products={products} form={form} slug={slug} />
      <PackFields fields={form.fields} values={(lead?.packData as PackValues) ?? {}} lookups={form.lookups} groupLabels={form.groupLabels} />
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

export function NewLeadForm(props: { slug: string; products: LeadProduct[]; team: Member[]; autoAssign: boolean; form: PackFormProps }) {
  return (
    <ActionForm action={createLeadAction.bind(null, props.slug)} className="flex flex-col gap-4">
      <DuplicateNotice />
      <LeadFields products={props.products} team={props.team} autoAssign={props.autoAssign} form={props.form} slug={props.slug} />
      <div className="flex justify-end">
        <SubmitButton>Create lead</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function EditLeadForm(props: { slug: string; lead: Lead; products: LeadProduct[]; team: Member[]; form: PackFormProps; onDone?: () => void }) {
  return (
    <ActionForm action={updateLeadAction.bind(null, props.slug, props.lead.id)} onSuccess={props.onDone} className="flex flex-col gap-4">
      <LeadFields lead={props.lead} products={props.products} team={props.team} autoAssign={false} form={props.form} slug={props.slug} />
      <div className="flex justify-end">
        <SubmitButton>Save</SubmitButton>
      </div>
    </ActionForm>
  );
}
