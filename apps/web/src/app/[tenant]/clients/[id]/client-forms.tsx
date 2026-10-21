'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import type { Client, FamilyMember, VisaProduct } from '@kicko/db';
import { ActionButton, ActionForm, FormBanner, FormField, Modal, SubmitButton } from '@/components/forms';
import { Button, Input, Select, Textarea, buttonCls } from '@/components/ui';
import { COUNTRIES, FAMILY_RELATIONS } from '@/lib/constants';
import { addFamilyAction, openCaseAction, removeFamilyAction, updateClientAction, updateClientJsonAction } from '../../actions';

const d = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : '');

export function ProfileForm({ slug, client, team }: { slug: string; client: Client; team: { userId: string; name: string }[] }) {
  const [saved, setSaved] = useState(false);
  return (
    <ActionForm action={updateClientAction.bind(null, slug, client.id)} onSuccess={() => setSaved(true)} className="flex flex-col gap-4">
      {saved && <FormBanner tone="ok">Profile saved.</FormBanner>}
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        <FormField label="First name" name="firstName"><Input name="firstName" defaultValue={client.firstName} required /></FormField>
        <FormField label="Last name" name="lastName"><Input name="lastName" defaultValue={client.lastName ?? ''} /></FormField>
        <FormField label="Date of birth" name="dob"><Input name="dob" type="date" defaultValue={d(client.dob)} /></FormField>
        <FormField label="Phone" name="phone"><Input name="phone" type="tel" defaultValue={client.phone ?? ''} /></FormField>
        <FormField label="Email" name="email"><Input name="email" type="email" defaultValue={client.email ?? ''} /></FormField>
        <FormField label="Gender" name="gender">
          <Select name="gender" defaultValue={client.gender ?? ''}>
            <option value="">—</option><option>Female</option><option>Male</option><option>Other</option>
          </Select>
        </FormField>
        <FormField label="Nationality" name="nationality"><Input name="nationality" defaultValue={client.nationality ?? 'Indian'} /></FormField>
        <FormField label="Passport number" name="passportNumber"><Input name="passportNumber" defaultValue={client.passportNumber ?? ''} className="uppercase" /></FormField>
        <FormField label="Passport expiry" name="passportExpiry"><Input name="passportExpiry" type="date" defaultValue={d(client.passportExpiry)} /></FormField>
        <FormField label="Marital status" name="maritalStatus">
          <Select name="maritalStatus" defaultValue={client.maritalStatus ?? ''}>
            <option value="">—</option><option>Single</option><option>Married</option><option>De facto</option><option>Divorced</option><option>Widowed</option>
          </Select>
        </FormField>
        <FormField label="Owner" name="ownerId">
          <Select name="ownerId" defaultValue={client.ownerId ?? ''}>
            <option value="">Unassigned</option>
            {team.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </Select>
        </FormField>
        <FormField label="Address" name="address" className="sm:col-span-2 lg:col-span-3">
          <Textarea name="address" defaultValue={client.address ?? ''} className="min-h-16" />
        </FormField>
      </div>
      <div className="flex justify-end"><SubmitButton>Save profile</SubmitButton></div>
    </ActionForm>
  );
}

type Row = Record<string, string>;

/** Editable list for tests / education / work, saved as JSON on the client. */
export function RepeaterEditor({
  slug,
  clientId,
  field,
  initial,
  columns,
  blank,
}: {
  slug: string;
  clientId: string;
  field: 'tests' | 'education' | 'work';
  initial: Row[];
  columns: { key: string; label: string; options?: readonly string[]; width?: string; type?: string }[];
  blank: Row;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(initial);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (i: number, k: string, v: string) => {
    setRows((r) => r.map((row, j) => (j === i ? { ...row, [k]: v } : row)));
    setDirty(true);
  };
  return (
    <div className="flex flex-col gap-3">
      {msg && <FormBanner tone={msg.ok ? 'ok' : 'error'}>{msg.text}</FormBanner>}
      {rows.length === 0 && <p className="text-sm text-muted">Nothing added.</p>}
      {rows.map((row, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 rounded-[14px] bg-paper-3 p-3">
          {columns.map((c) => (
            <label key={c.key} className="flex flex-col gap-1" style={{ width: c.width ?? '120px', flexGrow: c.width ? 0 : 1 }}>
              <span className="text-[11px] font-semibold text-muted">{c.label}</span>
              {c.options ? (
                <Select value={row[c.key] ?? ''} onChange={(e) => set(i, c.key, e.target.value)} className="h-9">
                  {c.options.map((o) => <option key={o}>{o}</option>)}
                </Select>
              ) : (
                <Input value={row[c.key] ?? ''} type={c.type ?? 'text'} onChange={(e) => set(i, c.key, e.target.value)} className="h-9" />
              )}
            </label>
          ))}
          <button type="button" aria-label="Remove row" onClick={() => { setRows((r) => r.filter((_, j) => j !== i)); setDirty(true); }} className={buttonCls('ghost', 'sm', 'w-9 px-0')}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <div className="flex justify-between gap-2">
        <Button size="sm" onClick={() => { setRows((r) => [...r, { ...blank }]); setDirty(true); }}>
          <Plus size={14} /> Add
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!dirty || pending}
          onClick={() =>
            start(async () => {
              const res = await updateClientJsonAction(slug, clientId, field, rows);
              setMsg(res.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: res.error });
              if (res.ok) {
                setDirty(false);
                router.refresh();
              }
            })
          }
        >
          Save
        </Button>
      </div>
    </div>
  );
}

export function FamilyPanel({ slug, clientId, family }: { slug: string; clientId: string; family: FamilyMember[] }) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y divide-line">
        {family.length === 0 && <li className="py-2 text-sm text-muted">No family members added.</li>}
        {family.map((f) => (
          <li key={f.id} className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{f.name}</div>
              <div className="text-xs text-muted">
                {f.relation.charAt(0) + f.relation.slice(1).toLowerCase()}
                {f.dob ? ` · born ${d(f.dob)}` : ''}
                {f.included ? ' · included in application' : ''}
              </div>
            </div>
            <ActionButton action={() => removeFamilyAction(slug, f.id)} variant="ghost" confirm={`Remove ${f.name}?`} title="Remove" className="w-8 px-0">
              <Trash2 size={14} />
            </ActionButton>
          </li>
        ))}
      </ul>
      <Modal title="Add family member" trigger={(open) => <Button size="sm" onClick={open}><Plus size={14} /> Add family member</Button>}>
        {(close) => (
          <ActionForm action={addFamilyAction.bind(null, slug, clientId)} onSuccess={close} className="flex flex-col gap-3.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Relation" name="relation">
                <Select name="relation" defaultValue="SPOUSE">
                  {FAMILY_RELATIONS.map((r) => <option key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</option>)}
                </Select>
              </FormField>
              <FormField label="Full name" name="name"><Input name="name" required /></FormField>
              <FormField label="Date of birth" name="dob"><Input name="dob" type="date" /></FormField>
              <FormField label="Passport number" name="passportNumber"><Input name="passportNumber" className="uppercase" /></FormField>
            </div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" name="included" defaultChecked className="h-4 w-4 accent-[#121417]" /> Included as a dependant on the application
            </label>
            <div className="flex justify-end"><SubmitButton>Add</SubmitButton></div>
          </ActionForm>
        )}
      </Modal>
    </div>
  );
}

export function OpenCaseButton({
  slug,
  clientId,
  products,
  team,
  me,
}: {
  slug: string;
  clientId: string;
  products: Pick<VisaProduct, 'id' | 'name' | 'country' | 'category'>[];
  team: { userId: string; name: string }[];
  me: string;
}) {
  return (
    <Modal title="Open a case" trigger={(open) => <Button variant="primary" size="sm" onClick={open}><Plus size={14} /> Open case</Button>}>
      {() => (
        <ActionForm action={openCaseAction.bind(null, slug, clientId)} className="flex flex-col gap-3.5">
          <FormField label="Visa product" name="productId">
            <Select name="productId" required defaultValue="">
              <option value="" disabled>Choose…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{COUNTRIES[p.country] ?? p.country} · {p.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Case owner" name="ownerId">
            <Select name="ownerId" defaultValue={me}>
              {team.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
            </Select>
          </FormField>
          <div className="flex justify-end"><SubmitButton>Open case</SubmitButton></div>
        </ActionForm>
      )}
    </Modal>
  );
}
