import type { Prisma } from '@kicko/db';
import { PLANS, type PlanId, type SubStatus } from '@/lib/plans';

export const STATUS_TONE: Record<SubStatus, 'ok' | 'info' | 'warn' | 'danger' | 'neutral'> = {
  trialing: 'info', active: 'ok', past_due: 'warn', read_only: 'danger', suspended: 'danger', canceled: 'neutral',
};

export const ACTION_LABEL: Record<string, string> = {
  extend_trial: 'Trial extended',
  set_plan: 'Plan set by hand',
  set_discount: 'Discount set',
  add_credits: 'Credits added',
  suspend: 'Suspended',
  reactivate: 'Reactivated',
  note: 'Note',
};

export function describeAction(action: string, details: Prisma.JsonValue) {
  const d = (details ?? {}) as Record<string, string | number>;
  const why = d.reason ? ` · ${d.reason}` : '';
  switch (action) {
    case 'extend_trial': return `+${d.days} days${why}`;
    case 'set_plan': return `${PLANS[d.plan as PlanId]?.name ?? d.plan}, ${d.seats} seats, ${d.months} months${why}`;
    case 'set_discount': return `${d.pct}%${why}`;
    case 'add_credits': return `${Number(d.credits).toLocaleString('en-IN')} credits${why}`;
    case 'note': return String(d.note ?? '');
    default: return String(d.reason ?? '');
  }
}
