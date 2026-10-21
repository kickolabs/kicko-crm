'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ActionButton, ActionForm, CopyField, FormField, Modal, SubmitButton } from '@/components/forms';
import { Badge, Button, Input, Select, Textarea } from '@/components/ui';
import { formatMoney, toInputAmount } from '@/lib/money';
import { markCommissionsPaidAction, partnerLinkAction, revokePartnerAction, saveSubAgentAction, setLeadSubAgentAction, voidCommissionAction } from '../../actions-phase6';

type Agent = {
  id: string;
  name: string;
  company: string | null;
  email: string;
  phone: string | null;
  city: string | null;
  commissionType: string;
  commissionValue: number;
  notes: string | null;
  active: boolean;
};

export function AgentEditor({ slug, agent }: { slug: string; agent?: Agent }) {
  const router = useRouter();
  const [type, setType] = useState(agent?.commissionType ?? 'PERCENT');
  return (
    <Modal
      title={agent ? 'Edit sub-agent' : 'New sub-agent'}
      trigger={(open) => <Button size="sm" variant={agent ? 'secondary' : 'primary'} onClick={open}>{agent ? 'Edit' : '+ Sub-agent'}</Button>}
    >
      {(close) => (
        <ActionForm
          action={saveSubAgentAction.bind(null, slug, agent?.id ?? null)}
          onSuccess={(r) => {
            close();
            if (!agent && r.ok && r.data) router.push(`/${slug}/partners/agents/${r.data as string}`);
          }}
          className="flex flex-col gap-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Contact name" name="name"><Input name="name" defaultValue={agent?.name} required /></FormField>
            <FormField label="Company" name="company"><Input name="company" defaultValue={agent?.company ?? ''} /></FormField>
            <FormField label="Email (their portal login)" name="email"><Input name="email" type="email" defaultValue={agent?.email} required /></FormField>
            <FormField label="Phone" name="phone"><Input name="phone" type="tel" defaultValue={agent?.phone ?? ''} /></FormField>
            <FormField label="City" name="city"><Input name="city" defaultValue={agent?.city ?? ''} /></FormField>
            <FormField label="Commission" name="commissionType">
              <Select name="commissionType" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="PERCENT">% of each client payment (before GST)</option>
                <option value="FIXED">Fixed fee per client who signs up</option>
              </Select>
            </FormField>
            <FormField label={type === 'PERCENT' ? 'Percentage' : 'Fee (₹)'} name="commission">
              <Input
                name="commission"
                inputMode="decimal"
                defaultValue={agent ? (agent.commissionType === 'PERCENT' ? String(agent.commissionValue / 100) : toInputAmount(agent.commissionValue)) : type === 'PERCENT' ? '10' : ''}
                required
              />
            </FormField>
            {agent && (
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" name="active" defaultChecked={agent.active} className="h-4 w-4 accent-ink" /> Active (can sign in and earn)
              </label>
            )}
          </div>
          <FormField label="Internal notes" name="notes"><Textarea name="notes" defaultValue={agent?.notes ?? ''} className="min-h-16" /></FormField>
          <p className="text-xs text-muted">A rate change applies to future payments only. Commission already earned keeps its amount.</p>
          <div><SubmitButton>{agent ? 'Save' : 'Add sub-agent'}</SubmitButton></div>
        </ActionForm>
      )}
    </Modal>
  );
}

export function PartnerAccess({ slug, agentId, lastSeen }: { slug: string; agentId: string; lastSeen: string | null }) {
  const [link, setLink] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{lastSeen ? `Last signed in ${lastSeen}.` : 'Not signed in yet.'} They can also request a link themselves from the partner login page.</p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await partnerLinkAction(slug, agentId);
              if (r.ok && r.data) {
                setLink(r.data);
                setErr(null);
              } else if (!r.ok) setErr(r.error);
            })
          }
        >
          Create portal link
        </Button>
        <ActionButton action={() => revokePartnerAction(slug, agentId)} variant="ghost" size="md" confirm="Sign this partner out everywhere and cancel unused links?">Revoke access</ActionButton>
      </div>
      {err && <p role="alert" className="text-xs font-semibold text-danger">{err}</p>}
      {link && <CopyField value={link} label="Partner portal link" />}
    </div>
  );
}

type Row = { id: string; client: string; kind: string; basis: number; amount: number; currency: string; status: string; at: string; paidRef: string | null };

export function CommissionLedger({ slug, agentId, rows, canPay }: { slug: string; agentId: string; rows: Row[]; canPay: boolean }) {
  const due = rows.filter((r) => r.status === 'DUE');
  const [picked, setPicked] = useState<string[]>(due.map((r) => r.id));
  const total = due.filter((r) => picked.includes(r.id)).reduce((s, r) => s + r.amount, 0);
  return (
    <div className="flex flex-col">
      <ul className="divide-y divide-line">
        {rows.length === 0 && <li className="px-5 py-5 text-sm text-muted">No commission yet. It's added automatically when referred clients pay.</li>}
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            {canPay && r.status === 'DUE' && (
              <input
                type="checkbox"
                aria-label={`Include ${r.client} ${formatMoney(r.amount, r.currency)}`}
                checked={picked.includes(r.id)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.id] : p.filter((x) => x !== r.id)))}
                className="h-4 w-4 accent-ink"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{r.client}</div>
              <div className="text-xs text-muted">
                {r.kind === 'REFERRAL_FEE' ? 'Referral fee' : `Share of ${formatMoney(r.basis, r.currency)} (before GST)`} · {r.at}
                {r.paidRef ? ` · paid (${r.paidRef})` : ''}
              </div>
            </div>
            <span className="font-bold tabular-nums">{formatMoney(r.amount, r.currency)}</span>
            <Badge tone={r.status === 'PAID' ? 'ok' : r.status === 'VOID' ? 'neutral' : 'warn'}>{r.status === 'DUE' ? 'Due' : r.status === 'PAID' ? 'Paid' : 'Void'}</Badge>
            {canPay && r.status === 'DUE' && (
              <ActionButton action={() => voidCommissionAction(slug, r.id)} variant="ghost" confirm="Void this commission? Use this if the payment was refunded.">Void</ActionButton>
            )}
          </li>
        ))}
      </ul>
      {canPay && due.length > 0 && (
        <ActionForm action={markCommissionsPaidAction.bind(null, slug, agentId)} className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-4">
          {picked.map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
          <FormField label="Payment reference (UTR / cheque no.)" name="paidRef" className="min-w-56 flex-1"><Input name="paidRef" required /></FormField>
          <SubmitButton>Mark {formatMoney(total)} as paid</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}

export function SubAgentPicker({ slug, leadId, value, agents }: { slug: string; leadId: string; value: string | null; agents: { id: string; label: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Select
      aria-label="Referred by sub-agent"
      value={value ?? ''}
      disabled={pending}
      onChange={(e) => {
        const v = e.target.value;
        start(async () => {
          await setLeadSubAgentAction(slug, leadId, v || null);
          router.refresh();
        });
      }}
      className="h-8 w-56 text-[13px]"
    >
      <option value="">None</option>
      {agents.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
    </Select>
  );
}
