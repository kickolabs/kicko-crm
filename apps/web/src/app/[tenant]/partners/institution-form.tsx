'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { ActionButton, ActionForm, FormBanner, FormField, Modal, SubmitButton } from '@/components/forms';
import { Button, Input, Select, Textarea } from '@/components/ui';
import { CURRENCIES, formatMoney, toInputAmount } from '@/lib/money';
import { addCourseAction, removeCourseAction, saveInstitutionAction } from '../actions-phase2';

export type InstitutionData = {
  id: string;
  name: string;
  country: string;
  city: string | null;
  kind: string;
  website: string | null;
  contactEmail: string | null;
  currency: string;
  commissionType: string;
  commissionValue: number;
  commissionBasis: string;
  agreementUntil: string | null;
  notes: string | null;
  active: boolean;
};

const DEFAULT_CURRENCY: Record<string, string> = { CA: 'CAD', AU: 'AUD', GB: 'GBP', US: 'USD', NZ: 'NZD', DE: 'EUR', IE: 'EUR', FR: 'EUR', EU: 'EUR', SG: 'SGD', AE: 'AED' };

export function InstitutionForm({ slug, inst, countries }: { slug: string; inst?: InstitutionData; countries: [string, string][] }) {
  const [country, setCountry] = useState(inst?.country ?? 'CA');
  const [currency, setCurrency] = useState(inst?.currency ?? 'CAD');
  const [type, setType] = useState(inst?.commissionType ?? 'PERCENT');
  const [saved, setSaved] = useState(false);
  return (
    <ActionForm action={saveInstitutionAction.bind(null, slug, inst?.id ?? null)} onSuccess={() => setSaved(true)} className="flex flex-col gap-4">
      {saved && <FormBanner tone="ok">Saved.</FormBanner>}
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        <FormField label="Name" name="name" className="sm:col-span-2"><Input name="name" defaultValue={inst?.name} required autoFocus={!inst} /></FormField>
        <FormField label="Type" name="kind">
          <Select name="kind" defaultValue={inst?.kind ?? 'UNIVERSITY'}>
            <option value="UNIVERSITY">University</option><option value="COLLEGE">College / Polytechnic</option><option value="SCHOOL">School / Language school</option><option value="AGGREGATOR">Aggregator</option>
          </Select>
        </FormField>
        <FormField label="Country" name="country">
          <Select name="country" value={country} onChange={(e) => { setCountry(e.target.value); setCurrency(DEFAULT_CURRENCY[e.target.value] ?? currency); }}>
            {countries.filter(([c]) => c !== 'EU').map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </Select>
        </FormField>
        <FormField label="City" name="city"><Input name="city" defaultValue={inst?.city ?? ''} /></FormField>
        <FormField label="Currency" name="currency">
          <Select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </FormField>
        <FormField label="Website" name="website"><Input name="website" defaultValue={inst?.website ?? ''} placeholder="https://" /></FormField>
        <FormField label="Partner contact email" name="contactEmail"><Input name="contactEmail" type="email" defaultValue={inst?.contactEmail ?? ''} /></FormField>
        <FormField label="Agreement valid until" name="agreementUntil"><Input name="agreementUntil" type="date" defaultValue={inst?.agreementUntil?.slice(0, 10) ?? ''} /></FormField>
      </div>
      <fieldset className="grid gap-3.5 rounded-[14px] bg-paper-3 p-4 sm:grid-cols-3">
        <legend className="sr-only">Commission</legend>
        <FormField label="Commission" name="commissionType">
          <Select name="commissionType" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="PERCENT">Percentage of tuition</option>
            <option value="FLAT">Flat amount per student</option>
          </Select>
        </FormField>
        <FormField label={type === 'PERCENT' ? 'Percent (%)' : `Amount (${currency})`} name="commissionValue">
          <Input name="commissionValue" inputMode="decimal" defaultValue={inst ? (inst.commissionType === 'PERCENT' ? String(inst.commissionValue / 100) : toInputAmount(inst.commissionValue)) : '15'} required />
        </FormField>
        <FormField label="Basis" name="commissionBasis"><Input name="commissionBasis" defaultValue={inst?.commissionBasis ?? 'First-year tuition'} /></FormField>
      </fieldset>
      <FormField label="Notes" name="notes"><Textarea name="notes" defaultValue={inst?.notes ?? ''} className="min-h-16" placeholder="Claim process, bonus tiers, contact person…" /></FormField>
      {inst && (
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" name="active" defaultChecked={inst.active} className="h-4 w-4 accent-[#121417]" /> Active partner
        </label>
      )}
      <div className="flex justify-end"><SubmitButton>{inst ? 'Save' : 'Add institution'}</SubmitButton></div>
    </ActionForm>
  );
}

export function CoursesPanel({
  slug,
  institutionId,
  currency,
  courses,
  canManage,
}: {
  slug: string;
  institutionId: string;
  currency: string;
  courses: { id: string; name: string; level: string | null; durationMonths: number | null; tuitionFee: number | null; intakes: string | null }[];
  canManage: boolean;
}) {
  return (
    <div className="flex flex-col">
      <ul className="divide-y divide-line">
        {courses.length === 0 && <li className="px-5 py-4 text-sm text-muted">No courses yet.</li>}
        {courses.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{c.name}</div>
              <div className="text-xs text-muted">
                {[c.level, c.durationMonths && `${c.durationMonths} months`, c.intakes && `Intakes: ${c.intakes}`].filter(Boolean).join(' · ')}
              </div>
            </div>
            {c.tuitionFee != null && <span className="text-sm font-bold">{formatMoney(c.tuitionFee, currency)}<span className="text-xs font-medium text-muted">/yr</span></span>}
            {canManage && (
              <ActionButton action={() => removeCourseAction(slug, c.id)} variant="ghost" title="Remove course" confirm={`Remove ${c.name}?`} className="w-8 px-0"><Trash2 size={14} /></ActionButton>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="border-t border-line px-5 py-3">
          <Modal title="Add course" trigger={(open) => <Button size="sm" onClick={open}>+ Course</Button>}>
            {(close) => (
              <ActionForm action={addCourseAction.bind(null, slug, institutionId)} onSuccess={close} resetOnSuccess className="flex flex-col gap-3.5">
                <FormField label="Course" name="name"><Input name="name" required autoFocus /></FormField>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Level" name="level">
                    <Select name="level" defaultValue="PG Diploma">
                      {['Certificate', 'Diploma', 'Advanced Diploma', 'PG Diploma', "Bachelor's", "Master's", 'MBA', 'PhD', 'Foundation', 'English'].map((l) => <option key={l}>{l}</option>)}
                    </Select>
                  </FormField>
                  <FormField label="Duration (months)" name="durationMonths"><Input name="durationMonths" inputMode="numeric" /></FormField>
                  <FormField label={`Tuition per year (${currency})`} name="tuitionFee"><Input name="tuitionFee" inputMode="decimal" /></FormField>
                  <FormField label="Intakes" name="intakes"><Input name="intakes" placeholder="Jan, May, Sep" /></FormField>
                </div>
                <div className="flex justify-end"><SubmitButton>Add course</SubmitButton></div>
              </ActionForm>
            )}
          </Modal>
        </div>
      )}
    </div>
  );
}
