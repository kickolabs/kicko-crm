import 'server-only';
import type { Prisma, VisaCategory } from '@kicko/db';
import { CATEGORIES } from '@/lib/constants';
import { db, type Ctx } from '@/lib/tenant';

// The client journey on the dashboard, leads and cases together, in phases that
// hold for every visa product whatever its own steps. Counts are "in this phase
// now"; Decided counts the last 90 days, matching the approval-rate tile.

export type Phase = 'enquiry' | 'qualified' | 'preparing' | 'lodged' | 'decided';
export const PHASES: { key: Phase; label: string }[] = [
  { key: 'enquiry', label: 'Enquiry' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'lodged', label: 'Lodged' },
  { key: 'decided', label: 'Decided · 90d' },
];

export const DECIDED_DAYS = 90;
const decidedSince = (now = new Date()) => new Date(now.getTime() - DECIDED_DAYS * 86400_000);

/** Prisma filter for the cases in one phase (also used by the Cases list's phase filter). */
export function casePhaseWhere(phase: 'preparing' | 'lodged' | 'decided', now = new Date()): Prisma.CaseWhereInput {
  if (phase === 'decided') return { decisionAt: { gt: decidedSince(now) } };
  if (phase === 'lodged') return { status: { not: 'CLOSED' }, lodgedAt: { not: null }, decisionAt: null };
  return { status: { not: 'CLOSED' }, lodgedAt: null, decisionAt: null };
}

export type FlowFilters = { category?: string; branch?: string };

export function getStageFlow(ctx: Ctx, f: FlowFilters, now = new Date()) {
  const category = CATEGORIES.includes(f.category as VisaCategory) ? (f.category as VisaCategory) : undefined;
  const branchId = f.branch || undefined;
  const leadWhere: Prisma.LeadWhereInput = { ...(category ? { interestCategory: category } : {}), ...(branchId ? { branchId } : {}) };
  const caseWhere: Prisma.CaseWhereInput = { ...(category ? { product: { category } } : {}), ...(branchId ? { branchId } : {}) };

  return db(ctx, async (tx) => {
    const [enquiry, qualified, preparing, lodged, decided, active] = await Promise.all([
      tx.lead.count({ where: { ...leadWhere, status: { in: ['NEW', 'CONTACTED'] } } }),
      tx.lead.count({ where: { ...leadWhere, status: { in: ['QUALIFIED', 'CONSULT_BOOKED'] } } }),
      tx.case.count({ where: { ...caseWhere, ...casePhaseWhere('preparing', now) } }),
      tx.case.count({ where: { ...caseWhere, ...casePhaseWhere('lodged', now) } }),
      tx.case.groupBy({ by: ['outcome'], where: { ...caseWhere, ...casePhaseWhere('decided', now) }, _count: { _all: true } }),
      // Visa-type split of cases in progress: the branch filter applies, the visa-type one doesn't.
      tx.case.findMany({ where: { status: { not: 'CLOSED' }, decisionAt: null, ...(branchId ? { branchId } : {}) }, select: { product: { select: { category: true } } } }),
    ]);
    const outcome = (o: string) => decided.find((g) => g.outcome === o)?._count._all ?? 0;
    const byCategory = new Map<VisaCategory, number>();
    for (const c of active) byCategory.set(c.product.category, (byCategory.get(c.product.category) ?? 0) + 1);
    return {
      counts: { enquiry, qualified, preparing, lodged, decided: decided.reduce((s, g) => s + g._count._all, 0) } as Record<Phase, number>,
      outcomes: { approved: outcome('APPROVED'), refused: outcome('REFUSED'), withdrawn: outcome('WITHDRAWN') },
      split: CATEGORIES.map((c) => ({ category: c, n: byCategory.get(c) ?? 0 })).filter((s) => s.n > 0),
      category,
      branchId,
    };
  });
}
