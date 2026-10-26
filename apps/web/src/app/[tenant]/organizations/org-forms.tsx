'use client';

import { useState } from 'react';
import { ActionButton, ActionForm, FormBanner, FormField, SubmitButton } from '@/components/forms';
import { Input, Select, Textarea } from '@/components/ui';
import {
  addCandidateAction,
  createOpeningAction,
  createOrganizationAction,
  removeCandidateAction,
  setCandidateStageAction,
  updateOpeningAction,
  updateOrganizationAction,
} from '../actions-organizations';

type Option = { key: string; name: string; group?: string };
export type OrgValues = { name: string; country: string | null; city: string | null; industry: string | null; contact: Record<string, string | null>; data: Record<string, string | null>; notes: string | null };

const CountrySelect = ({ name, value, countries }: { name: string; value?: string | null; countries: Option[] }) => (
  <Select name={name} defaultValue={value ?? ''}>
    <option value="">Not set</option>
    {countries.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
  </Select>
);

export function OrganizationForm({ slug, org, countries, word }: { slug: string; org?: OrgValues & { id: string }; countries: Option[]; word: string }) {
  const [saved, setSaved] = useState(false);
  const action = org ? updateOrganizationAction.bind(null, slug, org.id) : createOrganizationAction.bind(null, slug);
  return (
    <ActionForm action={action} onSuccess={() => setSaved(true)} className="grid gap-3.5 sm:grid-cols-2">
      {saved && <div className="sm:col-span-2"><FormBanner tone="ok">Saved.</FormBanner></div>}
      <FormField label={`${word} name`} name="name" className="sm:col-span-2"><Input name="name" defaultValue={org?.name} required autoFocus={!org} /></FormField>
      <FormField label="Country" name="country"><CountrySelect name="country" value={org?.country} countries={countries} /></FormField>
      <FormField label="City" name="city"><Input name="city" defaultValue={org?.city ?? ''} /></FormField>
      <FormField label="Industry" name="industry"><Input name="industry" defaultValue={org?.industry ?? ''} placeholder="Logistics, healthcare, hospitality…" /></FormField>
      <FormField label="Sponsor / licence number" name="sponsorLicence" hint="If the employer is a licensed sponsor"><Input name="sponsorLicence" defaultValue={org?.data.sponsorLicence ?? ''} /></FormField>
      <FormField label="Contact person" name="contactName"><Input name="contactName" defaultValue={org?.contact.name ?? ''} /></FormField>
      <FormField label="Email" name="email"><Input name="email" type="email" defaultValue={org?.contact.email ?? ''} /></FormField>
      <FormField label="Phone" name="phone"><Input name="phone" type="tel" defaultValue={org?.contact.phone ?? ''} /></FormField>
      <FormField label="Website" name="website"><Input name="website" defaultValue={org?.contact.website ?? ''} /></FormField>
      <FormField label="Notes" name="notes" className="sm:col-span-2"><Textarea name="notes" defaultValue={org?.notes ?? ''} className="min-h-16" /></FormField>
      <div className="flex justify-end sm:col-span-2"><SubmitButton>{org ? 'Save' : `Add ${word.toLowerCase()}`}</SubmitButton></div>
    </ActionForm>
  );
}

export type OpeningValues = {
  id: string;
  title: string;
  status: string;
  closesAt: string | null;
  data: { occupation?: string | null; country?: string | null; productId?: string | null; positions?: number | null; salaryMin?: number | null; salaryMax?: number | null; currency?: string | null; minExperience?: number | null; licences?: string[]; qualification?: string | null; description?: string | null };
};

export function OpeningForm({
  slug,
  organizationId,
  opening,
  countries,
  occupations,
  products,
  qualifications,
  word,
}: {
  slug: string;
  organizationId?: string;
  opening?: OpeningValues;
  countries: Option[];
  occupations: Option[];
  products: { id: string; label: string; country: string }[];
  qualifications: string[];
  word: string;
}) {
  const [saved, setSaved] = useState(false);
  const d = opening?.data ?? {};
  const [country, setCountry] = useState(d.country ?? '');
  const action = opening ? updateOpeningAction.bind(null, slug, opening.id) : createOpeningAction.bind(null, slug, organizationId!);
  const groups = new Map<string, Option[]>();
  for (const o of occupations) groups.set(o.group ?? 'Other', [...(groups.get(o.group ?? 'Other') ?? []), o]);
  return (
    <ActionForm action={action} onSuccess={() => setSaved(true)} className="grid gap-3.5 sm:grid-cols-2">
      {saved && <div className="sm:col-span-2"><FormBanner tone="ok">Saved.</FormBanner></div>}
      <FormField label="Role" name="title" className="sm:col-span-2"><Input name="title" defaultValue={opening?.title} placeholder="e.g. Heavy truck driver" required /></FormField>
      <FormField label="Occupation" name="occupation">
        <Select name="occupation" defaultValue={d.occupation ?? ''}>
          <option value="">Not set</option>
          {[...groups.entries()].map(([g, list]) => (
            <optgroup key={g} label={g}>{list.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}</optgroup>
          ))}
        </Select>
      </FormField>
      <FormField label="Country" name="country">
        <Select name="country" value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">Not set</option>
          {countries.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
        </Select>
      </FormField>
      <FormField label="Visa workflow" name="productId" hint="Hiring opens a case on this workflow" className="sm:col-span-2">
        <Select name="productId" defaultValue={d.productId ?? ''}>
          <option value="">Not set</option>
          {products.filter((p) => !country || p.country === country).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </Select>
      </FormField>
      <FormField label="Positions" name="positions"><Input name="positions" type="number" min={1} defaultValue={d.positions ?? ''} /></FormField>
      <FormField label="Minimum experience (years)" name="minExperience"><Input name="minExperience" type="number" min={0} defaultValue={d.minExperience ?? ''} /></FormField>
      <FormField label="Salary from" name="salaryMin"><Input name="salaryMin" inputMode="decimal" defaultValue={d.salaryMin ?? ''} /></FormField>
      <FormField label="Salary to" name="salaryMax"><Input name="salaryMax" inputMode="decimal" defaultValue={d.salaryMax ?? ''} /></FormField>
      <FormField label="Currency" name="currency"><Input name="currency" maxLength={3} defaultValue={d.currency ?? ''} placeholder="AED" className="uppercase" /></FormField>
      <FormField label="Minimum qualification" name="qualification">
        <Select name="qualification" defaultValue={d.qualification ?? ''}>
          <option value="">Any</option>
          {qualifications.map((q) => <option key={q}>{q}</option>)}
        </Select>
      </FormField>
      <FormField label="Licences needed" name="licences" hint="Comma-separated categories, e.g. HMV, Forklift"><Input name="licences" defaultValue={(d.licences ?? []).join(', ')} /></FormField>
      <FormField label="Applications close" name="closesAt"><Input name="closesAt" type="date" defaultValue={opening?.closesAt?.slice(0, 10) ?? ''} /></FormField>
      {opening && (
        <FormField label="Status" name="status">
          <Select name="status" defaultValue={opening.status}>
            <option value="open">Open</option>
            <option value="on_hold">On hold</option>
            <option value="filled">Filled</option>
            <option value="closed">Closed</option>
          </Select>
        </FormField>
      )}
      <FormField label="Description" name="description" className="sm:col-span-2"><Textarea name="description" defaultValue={d.description ?? ''} className="min-h-16" /></FormField>
      <div className="flex justify-end sm:col-span-2"><SubmitButton>{opening ? 'Save' : `Add ${word.toLowerCase()}`}</SubmitButton></div>
    </ActionForm>
  );
}

export const STAGE_LABEL: Record<string, string> = { shortlisted: 'Shortlisted', submitted: 'Submitted to employer', interview: 'Interview', offered: 'Offered', hired: 'Hired', rejected: 'Not selected' };

export function CandidateStage({ slug, id, stage }: { slug: string; id: string; stage: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {error && <span role="alert" className="text-xs font-medium text-danger">{error}</span>}
      <Select
        aria-label="Candidate stage"
        defaultValue={stage}
        className="h-9 w-48"
        onChange={async (e) => {
          const res = await setCandidateStageAction(slug, id, e.target.value as never);
          setError(res.ok ? null : res.error);
        }}
      >
        {Object.entries(STAGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </Select>
      <ActionButton action={() => removeCandidateAction(slug, id)} variant="ghost" confirm="Remove from this shortlist?">Remove</ActionButton>
    </span>
  );
}

export function ShortlistButton({ slug, openingId, clientId, name }: { slug: string; openingId: string; clientId: string; name: string }) {
  return (
    <ActionButton action={() => addCandidateAction(slug, openingId, clientId)} variant="primary">
      <span className="sr-only">{name}: </span>Shortlist
    </ActionButton>
  );
}
