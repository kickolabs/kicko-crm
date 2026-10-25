'use client';

import { useState } from 'react';
import type { Role } from '@kicko/db';
import { ActionButton, ActionForm, CopyField, FormBanner, FormField, Modal, SubmitButton } from '@/components/forms';
import { Button, Card, CardHeader, Input, Select, Textarea } from '@/components/ui';
import type { WorkingHours } from '@/lib/booking-rules';
import { ROLE_LABEL } from '@/lib/permissions';
import type { ActionResult } from '@/lib/action';
import {
  inviteAction,
  revokeInviteAction,
  rotateFormKeyAction,
  setMemberHoursAction,
  updateGeneralAction,
  updateMemberAction,
  updateProductAction,
} from '../actions';

const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Kathmandu', 'Asia/Dhaka', 'Asia/Colombo', 'Asia/Karachi', 'Asia/Singapore', 'Europe/London', 'America/Toronto', 'Australia/Sydney', 'Pacific/Auckland'];

export function GeneralForm({ slug, name, timezone, assignment }: { slug: string; name: string; timezone: string; assignment: string }) {
  const [saved, setSaved] = useState(false);
  return (
    <ActionForm action={updateGeneralAction.bind(null, slug)} onSuccess={() => setSaved(true)} className="flex max-w-xl flex-col gap-4">
      {saved && <FormBanner tone="ok">Settings saved.</FormBanner>}
      <FormField label="Agency name" name="name"><Input name="name" defaultValue={name} required /></FormField>
      <FormField label="Timezone" name="timezone" hint="Dates, reminders and the dashboard use this timezone.">
        <Select name="timezone" defaultValue={timezone}>
          {[timezone, ...TIMEZONES.filter((t) => t !== timezone)].map((t) => <option key={t}>{t}</option>)}
        </Select>
      </FormField>
      <FormField label="New lead assignment" name="leadAssignment" hint="Round-robin gives each new lead to the counsellor with the fewest open leads.">
        <Select name="leadAssignment" defaultValue={assignment}>
          <option value="round_robin">Automatic (round-robin by workload)</option>
          <option value="manual">Manual</option>
        </Select>
      </FormField>
      <div><SubmitButton>Save</SubmitButton></div>
    </ActionForm>
  );
}

const ASSIGNABLE: Role[] = ['ADMIN', 'COUNSELLOR', 'DOC_OFFICER', 'ACCOUNTS'];

export function InviteForm({ slug }: { slug: string }) {
  const [link, setLink] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <ActionForm
        action={inviteAction.bind(null, slug) as (p: ActionResult | null, fd: FormData) => Promise<ActionResult>}
        onSuccess={(res) => res.ok && setLink((res.data as { link: string }).link)}
        resetOnSuccess
        className="flex flex-wrap items-end gap-3"
      >
        <FormField label="Email" name="email" className="min-w-60 flex-1"><Input name="email" type="email" required /></FormField>
        <FormField label="Role" name="role">
          <Select name="role" defaultValue="COUNSELLOR">
            {ASSIGNABLE.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        </FormField>
        <SubmitButton>Create invite</SubmitButton>
      </ActionForm>
      {link && (
        <div className="rounded-[14px] bg-lime-soft p-4">
          <p className="mb-2 text-sm font-semibold">Invite created. Send this link to your teammate:</p>
          <CopyField value={link} label="Invite link" />
        </div>
      )}
    </div>
  );
}

export function RevokeInvite({ slug, id, link }: { slug: string; id: string; link: string }) {
  return (
    <span className="flex items-center gap-2">
      <button type="button" className="text-[13px] font-semibold text-ink-2 underline underline-offset-4" onClick={() => navigator.clipboard.writeText(link)}>
        Copy link
      </button>
      <ActionButton action={() => revokeInviteAction(slug, id)} variant="ghost" confirm="Revoke this invite?">Revoke</ActionButton>
    </span>
  );
}

export function MemberControls({ slug, userId, role, isMe, canMakeOwner }: { slug: string; userId: string; role: Role; isMe: boolean; canMakeOwner: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const roles: Role[] = canMakeOwner ? ['OWNER', ...ASSIGNABLE] : role === 'OWNER' ? ['OWNER'] : ASSIGNABLE;
  return (
    <span className="flex flex-wrap items-center gap-2">
      {error && <span role="alert" className="text-xs font-medium text-danger">{error}</span>}
      <label className="sr-only" htmlFor={`role-${userId}`}>Role</label>
      <Select
        id={`role-${userId}`}
        defaultValue={role}
        disabled={!canMakeOwner && role === 'OWNER'}
        className="h-9 w-44"
        onChange={async (e) => {
          const res = await updateMemberAction(slug, userId, { role: e.target.value as Role });
          setError(res.ok ? null : res.error);
          if (!res.ok) e.target.value = role;
        }}
      >
        {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
      </Select>
      {!isMe && (
        <ActionButton action={() => updateMemberAction(slug, userId, { active: false })} variant="ghost" confirm="Remove this person's access to the workspace?">
          Remove
        </ActionButton>
      )}
    </span>
  );
}

const WEEK = [
  [1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun'],
] as const;

/** A consultant's own working hours. Bookings with them must fit these; off = the agency's office hours. */
export function MemberHours({ slug, userId, name, hours, agency }: { slug: string; userId: string; name: string; hours: WorkingHours | null; agency: WorkingHours }) {
  const [own, setOwn] = useState(hours !== null);
  const h = hours ?? agency;
  return (
    <Modal
      title={`Working hours · ${name}`}
      trigger={(open) => (
        <Button size="sm" variant="ghost" onClick={open} aria-label={`Working hours for ${name}`}>
          {hours ? `${hours.start}–${hours.end}` : 'Office hours'}
        </Button>
      )}
    >
      {(close) => (
        <ActionForm action={setMemberHoursAction.bind(null, slug, userId)} onSuccess={close} className="flex flex-col gap-4">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" name="own" checked={own} onChange={(e) => setOwn(e.target.checked)} className="size-4 accent-[var(--color-ink)]" />
            Set own hours (otherwise the office hours apply: {agency.start}–{agency.end})
          </label>
          <fieldset disabled={!own} className="flex flex-col gap-3 disabled:opacity-50">
            <FormField label="Working days" name="days">
              <div className="flex flex-wrap gap-2">
                {WEEK.map(([d, label]) => (
                  <label key={d} className="flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-sm shadow-[inset_0_0_0_1px_var(--color-line-2)]">
                    <input type="checkbox" name="days" value={d} defaultChecked={h.days.includes(d)} className="accent-[var(--color-ink)]" />
                    {label}
                  </label>
                ))}
              </div>
            </FormField>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="From" name="start"><Input name="start" type="time" defaultValue={h.start} required /></FormField>
              <FormField label="Until" name="end"><Input name="end" type="time" defaultValue={h.end} required /></FormField>
            </div>
          </fieldset>
          <div className="flex justify-end"><SubmitButton>Save hours</SubmitButton></div>
        </ActionForm>
      )}
    </Modal>
  );
}

export function LeadCapture({ slug, formUrl, kioskUrl, apiUrl, formKey }: { slug: string; formUrl: string; kioskUrl: string; apiUrl: string; formKey: string }) {
  const iframe = `<iframe src="${formUrl}&embed=1" style="width:100%;max-width:560px;height:760px;border:0" title="Enquiry form"></iframe>`;
  const curl = `curl -X POST ${apiUrl} \\\n  -H "Content-Type: application/json" \\\n  -H "X-Form-Key: ${formKey}" \\\n  -d '{"firstName":"Asha","phone":"+919876543210","interestCountry":"CA","message":"Study in Canada"}'`;
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Website enquiry form" sub="Hosted form, or embed it on your website. Submissions become leads with source “Web form”." />
        <div className="flex flex-col gap-3 p-5">
          <CopyField value={formUrl} label="Form link" />
          <span className="text-xs font-semibold text-muted">Embed code</span>
          <CopyField value={iframe} label="Embed code" />
        </div>
      </Card>
      <Card>
        <CardHeader title="Walk-in kiosk" sub="Open on the reception tablet. Visitors check in and join the queue." />
        <div className="p-5"><CopyField value={kioskUrl} label="Kiosk link" /></div>
      </Card>
      <Card>
        <CardHeader title="Lead API" sub="For landing pages, Meta lead ads via Zapier/Make, or your own website backend." />
        <div className="flex flex-col gap-3 p-5">
          <pre className="overflow-x-auto rounded-[12px] bg-ink p-4 text-[12px] leading-relaxed text-paper">{curl}</pre>
          <div className="flex flex-wrap items-center gap-3">
            <ActionButton action={() => rotateFormKeyAction(slug)} variant="danger" confirm="Rotate the key? Existing embeds, kiosk links and API integrations stop working until you update them.">
              Rotate key
            </ActionButton>
            <span className="text-xs text-muted">Rotate if a link was shared somewhere it shouldn't be.</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

export function ProductEditor({ slug, id, name, active, stages, checklist }: { slug: string; id: string; name: string; active: boolean; stages: string; checklist: string }) {
  const [saved, setSaved] = useState(false);
  return (
    <ActionForm action={updateProductAction.bind(null, slug, id)} onSuccess={() => setSaved(true)} className="flex flex-col gap-4">
      {saved && <FormBanner tone="ok">Workflow saved.</FormBanner>}
      <div className="flex flex-wrap items-end gap-4">
        <FormField label="Name" name="name" className="min-w-64 flex-1"><Input name="name" defaultValue={name} required /></FormField>
        <label className="flex h-10 items-center gap-2 text-sm font-semibold">
          <input type="checkbox" name="active" defaultChecked={active} className="h-4 w-4 accent-[#121417]" /> Offered (visible when creating leads & cases)
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Stages, in order" name="stages" hint="One per line.">
          <Textarea name="stages" defaultValue={stages} className="min-h-80 font-mono text-[13px]" />
        </FormField>
        <FormField label="Document checklist" name="checklist" hint="One per line as “Group: Document”. Add (optional) at the end for non-required items.">
          <Textarea name="checklist" defaultValue={checklist} className="min-h-80 font-mono text-[13px]" />
        </FormField>
      </div>
      <div className="flex justify-end"><SubmitButton>Save workflow</SubmitButton></div>
    </ActionForm>
  );
}
