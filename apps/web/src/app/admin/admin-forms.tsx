'use client';

import { useState, type ReactNode } from 'react';
import { ActionForm, FormBanner, FormField, SubmitButton } from '@/components/forms';
import { Input, Select, Textarea } from '@/components/ui';
import type { ActionResult } from '@/lib/action';
import { PLAN_ORDER, PLANS } from '@/lib/plans';
import { extendTrialAction, grantCreditsAction, noteAction, reactivateAction, setDiscountAction, setPlanAction, suspendAction } from './actions';

type Bound = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

function Tool({ title, sub, action, button, danger, children }: { title: string; sub: ReactNode; action: Bound; button: string; danger?: boolean; children: ReactNode }) {
  const [done, setDone] = useState<string | null>(null);
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-[16px] p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <div>
        <h3 className="text-sm font-bold">{title}</h3>
        <p className="text-xs text-muted">{sub}</p>
      </div>
      <ActionForm action={action} resetOnSuccess onSuccess={(r) => setDone(r.ok ? (r.message ?? 'Saved') : null)} className="flex flex-col gap-3">
        {done && <FormBanner tone="ok">{done}</FormBanner>}
        {children}
        <SubmitButton variant={danger ? 'danger' : 'primary'} size="sm" className="self-start">{button}</SubmitButton>
      </ActionForm>
    </section>
  );
}

// Several forms on the page have a reason, so it is labelled per tool.
const Reason = ({ id }: { id: string }) => (
  <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
    Reason
    <Input name="reason" aria-label={`Reason (${id})`} placeholder="e.g. asked on a sales call" />
    <span className="text-xs font-normal text-muted">Saved in the admin log</span>
  </label>
);

export function AdminTools({ tenantId, status, discountPct, foundingLeft }: { tenantId: string; status: string; discountPct: number; foundingLeft: number }) {
  const suspended = status === 'suspended' || status === 'read_only';
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Tool title="Extend trial" sub="Adds days to a running trial, or restarts an expired one (lifts read-only)." action={extendTrialAction.bind(null, tenantId)} button="Extend trial">
        <FormField label="Days" name="days">
          <Input id="days" name="days" type="number" min={1} max={90} defaultValue={7} className="w-28" />
        </FormField>
        <Reason id="trial" />
      </Tool>

      <Tool
        title="Discount"
        sub={<>Applies from their next checkout or renewal. Founding customers get 30% ({foundingLeft} of 20 left). Now: {discountPct}%.</>}
        action={setDiscountAction.bind(null, tenantId)}
        button="Save discount"
      >
        <FormField label="Discount %" name="pct">
          <Input id="pct" name="pct" type="number" min={0} max={50} defaultValue={discountPct || 30} className="w-28" />
        </FormField>
        <Reason id="discount" />
      </Tool>

      <Tool title="Set plan by hand" sub="For complimentary accounts or bank-transfer payments. No card is charged and it doesn't auto-renew." action={setPlanAction.bind(null, tenantId)} button="Set plan">
        <div className="flex flex-wrap gap-3">
          <FormField label="Plan" name="plan">
            <Select id="plan" name="plan" defaultValue="growth">
              {PLAN_ORDER.map((p) => <option key={p} value={p}>{PLANS[p].name}</option>)}
            </Select>
          </FormField>
          <FormField label="Seats" name="seats">
            <Input id="seats" name="seats" type="number" min={1} max={500} defaultValue={5} className="w-24" />
          </FormField>
          <FormField label="Months" name="months">
            <Input id="months" name="months" type="number" min={1} max={36} defaultValue={12} className="w-24" />
          </FormField>
        </div>
        <Reason id="plan" />
      </Tool>

      <Tool title="Add AI credits" sub="Goodwill or support credits. Added to purchased credits, which never expire." action={grantCreditsAction.bind(null, tenantId)} button="Add credits">
        <FormField label="Credits" name="credits">
          <Input id="credits" name="credits" type="number" min={1} max={100000} defaultValue={500} className="w-28" />
        </FormField>
        <Reason id="credits" />
      </Tool>

      {suspended ? (
        <Tool title="Reactivate" sub="Returns them to the plan or trial that is still running." action={reactivateAction.bind(null, tenantId)} button="Reactivate">
          <Reason id="reactivate" />
        </Tool>
      ) : (
        <Tool title="Suspend" sub="Staff lose access straight away. Their clients' portal and incoming messages keep working, and no data is deleted." action={suspendAction.bind(null, tenantId)} button="Suspend agency" danger>
          <Reason id="suspend" />
        </Tool>
      )}

      <Tool title="Internal note" sub="Visible only to Kicko staff." action={noteAction.bind(null, tenantId)} button="Save note">
        <FormField label="Note" name="note">
          <Textarea id="note" name="note" rows={2} placeholder="e.g. Wants Tally export; follow up in Jan" />
        </FormField>
      </Tool>
    </div>
  );
}
