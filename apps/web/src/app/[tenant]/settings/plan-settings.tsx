'use client';

import clsx from 'clsx';
import { useState, useTransition } from 'react';
import { Check, Sparkles } from 'lucide-react';
import { ActionButton } from '@/components/forms';
import { Badge, Button, Card, CardHeader, Input } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { PLAN_ORDER, PLANS, quote, STATUS_LABEL, TOP_UP, type Interval, type PlanId, type SubStatus } from '@/lib/plans';
import { buyCreditsAction, cancelSubscriptionAction, startCheckoutAction } from '../actions-plan';

type Sub = {
  plan: PlanId;
  interval: Interval;
  status: SubStatus;
  seats: number;
  seatsUsed: number;
  trialDaysLeft: number | null;
  renews: string | null;
  cancelAtPeriodEnd: boolean;
  provider: string | null;
  discountPct: number;
  currency: 'INR' | 'USD';
};

const TONE: Record<SubStatus, 'ok' | 'info' | 'warn' | 'danger' | 'neutral'> = {
  trialing: 'info', active: 'ok', past_due: 'warn', read_only: 'danger', suspended: 'danger', canceled: 'neutral',
};

export function CurrentPlan({ slug, sub, paid }: { slug: string; sub: Sub; paid: boolean }) {
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-ink p-5 text-paper">
      {paid && <p role="status" className="rounded-[12px] bg-lime px-3.5 py-2 text-sm font-semibold text-ink">Payment received. Thank you!</p>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold tracking-wide text-paper/60 uppercase">Your plan</div>
          <div className="text-3xl font-extrabold tracking-tight">{sub.status === 'trialing' ? 'Free trial · everything included' : PLANS[sub.plan].name}</div>
          <div className="text-sm text-paper/70">
            {sub.status === 'trialing' && sub.trialDaysLeft != null ? `${sub.trialDaysLeft} day${sub.trialDaysLeft === 1 ? '' : 's'} left. Choose a plan below to keep going.` : null}
            {sub.status === 'active' && sub.renews ? `${sub.interval === 'year' ? 'Yearly' : 'Monthly'} · ${sub.cancelAtPeriodEnd ? 'ends' : 'renews'} ${sub.renews}${sub.provider === 'manual' ? ' (complimentary)' : ''}` : null}
            {sub.status === 'past_due' && 'The last payment failed. Update payment within 7 days to keep editing.'}
            {sub.status === 'read_only' && 'Read-only: your team can view and export, but not make changes. Choose a plan to continue.'}
            {sub.status === 'suspended' && 'Suspended. Choose a plan to restore access. Data is kept for 90 days.'}
          </div>
        </div>
        <Badge tone={TONE[sub.status]}>{STATUS_LABEL[sub.status]}</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span>Seats: <strong className="tabular-nums">{sub.seatsUsed} of {sub.seats}</strong> used</span>
        {sub.discountPct > 0 && <Badge tone="lime">{sub.discountPct}% founding discount</Badge>}
        {sub.status === 'active' && sub.provider !== 'manual' && !sub.cancelAtPeriodEnd && (
          <ActionButton action={() => cancelSubscriptionAction(slug, true)} variant="ghost" className="text-paper/70 hover:text-paper" confirm="Cancel at the end of this period? Everything keeps working until then.">
            Cancel subscription
          </ActionButton>
        )}
      </div>
    </section>
  );
}

export function PlanPicker({ slug, sub }: { slug: string; sub: Sub }) {
  const [interval, setPeriod] = useState<Interval>(sub.status === 'active' ? sub.interval : 'year');
  const [seats, setSeats] = useState(Math.max(sub.seatsUsed, sub.status === 'trialing' ? sub.seatsUsed : sub.seats));
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cur = sub.currency;
  const choose = (plan: PlanId) =>
    start(async () => {
      const r = await startCheckoutAction(slug, plan, interval, seats);
      if (r.ok && r.data) window.location.href = r.data;
      else if (!r.ok) setErr(r.error);
    });
  return (
    <Card>
      <CardHeader
        title={sub.status === 'active' ? 'Change plan' : 'Choose a plan'}
        sub={`Prices per user per month${cur === 'INR' ? ', before 18% GST' : ''}. Yearly saves two months.`}
        action={
          <div role="tablist" aria-label="Billing period" className="flex gap-1 rounded-full bg-paper-3 p-1">
            {(['year', 'month'] as const).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={interval === v} onClick={() => setPeriod(v)} className={clsx('rounded-full px-3 py-1 text-xs font-bold', interval === v ? 'bg-ink text-paper' : 'text-muted')}>
                {v === 'year' ? 'Yearly' : 'Monthly'}
              </button>
            ))}
          </div>
        }
      />
      <div className="flex flex-wrap items-end gap-3 px-5 pt-4">
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
          Users
          <Input type="number" min={Math.max(1, sub.seatsUsed)} max={500} value={seats} onChange={(e) => setSeats(Number(e.target.value))} className="w-28" aria-label="Users" />
        </label>
        <span className="pb-2.5 text-xs text-muted">{sub.seatsUsed} active on the team now</span>
      </div>
      {err && <p role="alert" className="px-5 pt-3 text-sm font-semibold text-danger">{err}</p>}
      <div className="grid gap-3 p-5 md:grid-cols-3">
        {PLAN_ORDER.map((id) => {
          const p = PLANS[id];
          const q = quote(id, interval, Math.max(1, seats || 1), cur, sub.discountPct);
          const current = sub.status === 'active' && sub.plan === id && sub.interval === interval && sub.seats === seats;
          return (
            <div key={id} className={clsx('flex flex-col gap-3 rounded-[18px] p-4', id === 'growth' ? 'bg-paper-3 shadow-[inset_0_0_0_2px_var(--color-ink)]' : 'shadow-[inset_0_0_0_1px_var(--color-line)]')}>
              <div className="flex items-center justify-between">
                <span className="text-lg font-extrabold">{p.name}</span>
                {id === 'growth' && <Badge tone="lime">Most popular</Badge>}
              </div>
              <div>
                <span className="text-3xl font-extrabold tracking-tight tabular-nums">{formatMoney(p.price[cur][interval], cur)}</span>
                <span className="text-xs text-muted"> /user/mo</span>
              </div>
              <div className="text-xs text-muted">{p.tagline}</div>
              <ul className="flex flex-col gap-1 text-[13px]">
                {p.highlights.map((h) => <li key={h} className="flex gap-1.5"><Check size={14} className="mt-0.5 shrink-0" />{h}</li>)}
                {p.creditsPerUser > 0 && (
                  <li className="flex gap-1.5"><Sparkles size={14} className="mt-0.5 shrink-0" />{p.creditsPerUser.toLocaleString('en-IN')} AI credits per user each month</li>
                )}
              </ul>
              <div className="mt-auto flex flex-col gap-1.5">
                <span className="text-xs text-muted">
                  {formatMoney(q.total, cur)} {interval === 'year' ? 'per year' : 'per month'}{cur === 'INR' ? ' incl. GST' : ''}
                </span>
                <Button variant={id === 'growth' ? 'primary' : 'secondary'} disabled={pending || current || seats < 1} onClick={() => choose(id)}>
                  {current ? 'Current plan' : pending ? 'Opening checkout…' : `Choose ${p.name}`}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function CreditsCard({ slug, credits, currency, sandboxAi }: { slug: string; credits: { allowance: number; used: number; topUp: number; remaining: number }; currency: 'INR' | 'USD'; sandboxAi: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const pct = credits.allowance ? Math.min(100, Math.round((credits.used / credits.allowance) * 100)) : 100;
  return (
    <Card>
      <CardHeader title="AI credits" sub="Used by AI call notes (4), WhatsApp AI replies (1), document checks (1) and voice agent notes (2). The allowance resets on the 1st." />
      <div className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span><strong className="tabular-nums">{credits.used.toLocaleString('en-IN')}</strong> of {credits.allowance.toLocaleString('en-IN')} used this month</span>
          <span className="text-muted">Purchased credits left: <strong className="text-ink tabular-nums">{credits.topUp.toLocaleString('en-IN')}</strong></span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-paper-2" aria-label={`${pct}% of monthly credits used`}><div className={clsx('h-full', pct >= 80 ? 'bg-warn' : 'bg-ink')} style={{ width: `${pct}%` }} /></div>
        {pct >= 80 && <p className="text-xs font-semibold text-warn-ink">{pct >= 100 ? 'Monthly credits are used up. AI steps pause until the 1st or a top-up; the CRM keeps working.' : 'Over 80% used this month.'}</p>}
        {sandboxAi && <p className="text-xs text-muted">AI is in sandbox mode (no API key yet), so nothing is charged.</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await buyCreditsAction(slug);
                if (r.ok && r.data) window.location.href = r.data;
                else if (!r.ok) setErr(r.error);
              })
            }
          >
            Buy {TOP_UP.credits.toLocaleString('en-IN')} credits · {formatMoney(TOP_UP.price[currency], currency)}{currency === 'INR' ? ' + GST' : ''}
          </Button>
          <span className="text-xs text-muted">Purchased credits never expire.</span>
          {err && <span role="alert" className="text-xs font-semibold text-danger">{err}</span>}
        </div>
      </div>
    </Card>
  );
}
