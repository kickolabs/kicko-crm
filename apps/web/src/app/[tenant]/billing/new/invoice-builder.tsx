'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ActionForm, FormField, SubmitButton } from '@/components/forms';
import { Button, Input, Select, Textarea, buttonCls } from '@/components/ui';
import { computeInvoice, formatMoney, parseMoney, toInputAmount, type PlanStep, type TaxMode } from '@/lib/money';
import { createInvoiceAction } from '../../actions-phase2';

export type ClientOpt = { id: string; name: string; ref: string; cases: { id: string; ref: string; label: string }[] };
export type PackageOpt = { id: string; name: string; description: string | null; price: number; taxRate: number; plan: PlanStep[] };

type Line = { description: string; quantity: string; unitPrice: string; taxRate: string };
const blank = (taxRate = '18'): Line => ({ description: '', quantity: '1', unitPrice: '', taxRate });

export function InvoiceBuilder({
  slug,
  clients,
  packages,
  defaults,
}: {
  slug: string;
  clients: ClientOpt[];
  packages: PackageOpt[];
  defaults: { clientId?: string; caseId?: string; taxMode: TaxMode; today: string };
}) {
  const [clientId, setClientId] = useState(defaults.clientId ?? '');
  const [caseId, setCaseId] = useState(defaults.caseId ?? '');
  const [taxMode, setTaxMode] = useState<TaxMode>(defaults.taxMode);
  const [issueDate, setIssueDate] = useState(defaults.today);
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [plan, setPlan] = useState('');
  const [notes, setNotes] = useState('');
  const [issue, setIssue] = useState(true);
  const client = clients.find((c) => c.id === clientId);

  const parsed = lines.map((l) => ({
    description: l.description,
    quantity: Math.max(1, Number.parseInt(l.quantity, 10) || 1),
    unitPrice: parseMoney(l.unitPrice) ?? 0,
    taxRate: Math.round((Number(l.taxRate) || 0) * 100),
  }));
  const totals = useMemo(() => computeInvoice(parsed, taxMode), [JSON.stringify(parsed), taxMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyPackage = (p: PackageOpt) => {
    setLines([{ description: p.name + (p.description ? ` — ${p.description}` : ''), quantity: '1', unitPrice: toInputAmount(p.price), taxRate: String(p.taxRate / 100) }]);
    setPlan(p.plan.map((s) => `${s.label}, ${s.percent}, ${s.dueDays}`).join('\n'));
  };
  const set = (i: number, k: keyof Line, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  const payload = JSON.stringify({
    clientId,
    caseId,
    issueDate,
    taxMode,
    notes,
    issue,
    plan,
    items: lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate || '0' })),
  });

  return (
    <ActionForm action={createInvoiceAction.bind(null, slug)} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <input type="hidden" name="payload" value={payload} />
      <div className="flex min-w-0 flex-col gap-5">
        <section className="card grid gap-4 p-5 sm:grid-cols-2">
          <FormField label="Client" name="clientId">
            <Select name="clientId" value={clientId} onChange={(e) => { setClientId(e.target.value); setCaseId(''); }} required>
              <option value="" disabled>Choose a client…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.ref}</option>)}
            </Select>
          </FormField>
          <FormField label="For case (optional)" name="caseId">
            <Select name="caseId" value={caseId} onChange={(e) => setCaseId(e.target.value)} disabled={!client?.cases.length}>
              <option value="">No specific case</option>
              {client?.cases.map((k) => <option key={k.id} value={k.id}>{k.ref} · {k.label}</option>)}
            </Select>
          </FormField>
          <FormField label="Invoice date" name="issueDate">
            <Input name="issueDate" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </FormField>
          <FormField label="Tax" name="taxMode" hint="Intra-state: client in your state (CGST+SGST). Inter-state or overseas: IGST.">
            <Select name="taxMode" value={taxMode} onChange={(e) => setTaxMode(e.target.value as TaxMode)}>
              <option value="GST_INTRA">GST: CGST + SGST</option>
              <option value="GST_INTER">GST: IGST</option>
              <option value="NONE">No tax</option>
            </Select>
          </FormField>
        </section>

        {packages.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow mr-1">Start from a package</span>
            {packages.map((p) => (
              <button key={p.id} type="button" onClick={() => applyPackage(p)} className="rounded-full bg-card px-3 py-1.5 text-xs font-semibold shadow-[var(--shadow-card)] hover:shadow-[0_0_0_1.5px_var(--color-ink)]">
                {p.name} · {formatMoney(p.price)}
              </button>
            ))}
          </div>
        )}

        <section className="card p-5" aria-label="Line items">
          <div className="hidden grid-cols-[minmax(0,1fr)_64px_130px_72px_36px] gap-2 pb-2 text-[11px] font-bold tracking-wider text-muted uppercase sm:grid">
            <span>Description</span><span>Qty</span><span>Price (₹)</span><span>GST %</span><span />
          </div>
          <div className="flex flex-col gap-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_64px_130px_72px_36px]">
                <Input aria-label="Description" value={l.description} onChange={(e) => set(i, 'description', e.target.value)} placeholder="e.g. Canada study visa package" className="col-span-2 sm:col-span-1" />
                <Input aria-label="Quantity" inputMode="numeric" value={l.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} />
                <Input aria-label="Price" inputMode="decimal" value={l.unitPrice} onChange={(e) => set(i, 'unitPrice', e.target.value)} placeholder="0" />
                <Input aria-label="GST %" inputMode="decimal" value={l.taxRate} onChange={(e) => set(i, 'taxRate', e.target.value)} disabled={taxMode === 'NONE'} />
                <button type="button" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className={buttonCls('ghost', 'sm', 'h-10 w-9 px-0')}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <Button size="sm" className="mt-3" onClick={() => setLines((ls) => [...ls, blank(ls[ls.length - 1]?.taxRate)])}>
            <Plus size={14} /> Line
          </Button>
        </section>

        <section className="card grid gap-4 p-5 sm:grid-cols-2">
          <FormField label="Installment plan" name="plan" hint={'One per line: label, percent, due after days. Empty = pay in full.'}>
            <Textarea name="plan" value={plan} onChange={(e) => setPlan(e.target.value)} className="min-h-28 font-mono text-[13px]" placeholder={'On signing, 50, 0\nVisa lodged, 30, 30\nDecision, 20, 60'} />
          </FormField>
          <FormField label="Notes on invoice" name="notes">
            <Textarea name="notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-28" placeholder="Visible to the client" />
          </FormField>
        </section>
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
        <section className="rounded-[var(--radius-card)] bg-ink p-5 text-paper">
          <span className="text-[11px] font-bold tracking-wider text-[#A9AFB7] uppercase">Total</span>
          <div className="mt-1 text-[36px] leading-none font-extrabold tracking-[-0.04em] text-lime">{formatMoney(totals.total)}</div>
          <dl className="mt-4 flex flex-col gap-1.5 text-[13px]">
            <Row k="Subtotal" v={formatMoney(totals.subtotal)} />
            {taxMode === 'GST_INTRA' && <><Row k="CGST" v={formatMoney(totals.cgst)} /><Row k="SGST" v={formatMoney(totals.sgst)} /></>}
            {taxMode === 'GST_INTER' && <Row k="IGST" v={formatMoney(totals.igst)} />}
          </dl>
        </section>
        <label className="flex items-center gap-2.5 rounded-[14px] bg-card px-4 py-3 text-sm font-semibold shadow-[var(--shadow-card)]">
          <input type="checkbox" checked={!issue} onChange={(e) => setIssue(!e.target.checked)} className="h-4 w-4 accent-[#121417]" />
          Save as draft (don't issue yet)
        </label>
        <SubmitButton size="lg" className="w-full">{issue ? 'Create & issue invoice' : 'Save draft'}</SubmitButton>
        <p className="text-xs leading-relaxed text-muted">Invoice numbers run in sequence per financial year (Apr–Mar), as GST requires.</p>
      </aside>
    </ActionForm>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[#A9AFB7]">{k}</dt>
      <dd className="font-semibold">{v}</dd>
    </div>
  );
}
