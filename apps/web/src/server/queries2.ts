import 'server-only';
import type { ClaimStatus, InvoiceStatus, Prisma } from '@kicko/db';
import { dayBounds } from '@/lib/format';
import { db, type Ctx } from '@/lib/tenant';
import { syncChecklistTx } from './documents';
import { scopeOf } from './scope';

// Read models for Phase 2 screens (documents, billing, partners).

export function getCaseDocuments(ctx: Ctx, caseId: string) {
  return db(ctx, async (tx) => {
    await syncChecklistTx(tx, scopeOf(ctx), caseId); // picks up checklist edits and pre-Phase-2 cases
    return tx.document.findMany({
      where: { caseId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { files: { orderBy: { createdAt: 'desc' } } },
    });
  });
}

export function getCaseApplications(ctx: Ctx, caseId: string) {
  return db(ctx, (tx) =>
    tx.application.findMany({
      where: { caseId },
      orderBy: { createdAt: 'asc' },
      include: { institution: true, course: true, claims: true },
    }),
  );
}

export function listInvoicesFor(ctx: Ctx, where: Prisma.InvoiceWhereInput) {
  return db(ctx, (tx) =>
    tx.invoice.findMany({
      where,
      orderBy: { issueDate: 'desc' },
      take: 300,
      include: { client: true, case: true, installments: true },
    }),
  );
}

export type InvoiceFilters = { status?: string; q?: string; overdue?: string };

export function listInvoices(ctx: Ctx, f: InvoiceFilters) {
  const where: Prisma.InvoiceWhereInput = {};
  if (f.status) where.status = f.status as InvoiceStatus;
  if (f.overdue) {
    where.status = { in: ['ISSUED', 'PARTIALLY_PAID'] };
    where.installments = { some: { dueDate: { lt: new Date() } } };
  }
  if (f.q) {
    const q = f.q.trim();
    where.OR = [
      { ref: { contains: q, mode: 'insensitive' } },
      { client: { firstName: { contains: q, mode: 'insensitive' } } },
      { client: { lastName: { contains: q, mode: 'insensitive' } } },
    ];
  }
  return listInvoicesFor(ctx, where);
}

export function getInvoice(ctx: Ctx, id: string) {
  return db(ctx, (tx) =>
    tx.invoice.findUnique({
      where: { id },
      include: {
        client: true,
        case: { include: { product: true } },
        items: { orderBy: { sortOrder: 'asc' } },
        installments: { orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }] },
        payments: { orderBy: { paidAt: 'desc' } },
        links: { orderBy: { createdAt: 'desc' } },
      },
    }),
  );
}

export function listPackages(ctx: Ctx, opts: { includeInactive?: boolean } = {}) {
  return db(ctx, (tx) =>
    tx.servicePackage.findMany({
      where: opts.includeInactive ? {} : { active: true },
      orderBy: { name: 'asc' },
      include: { product: true },
    }),
  );
}

/** Revenue report: this month, outstanding, overdue, last 12 months, by method. */
export function getBillingSummary(ctx: Ctx) {
  const tz = ctx.tenant.timezone;
  const today = dayBounds(tz);
  const monthStart = new Date(today.start);
  monthStart.setUTCDate(1);
  const yearAgo = new Date(monthStart);
  yearAgo.setUTCMonth(yearAgo.getUTCMonth() - 11);

  return db(ctx, async (tx) => {
    const [payments, open, overdueInst] = await Promise.all([
      tx.payment.findMany({ where: { paidAt: { gte: yearAgo } }, select: { amount: true, paidAt: true, method: true } }),
      tx.invoice.findMany({ where: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] } }, select: { total: true, amountPaid: true } }),
      tx.installment.findMany({
        where: { dueDate: { lt: today.start }, invoice: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] } } },
        select: { amount: true, paidAmount: true },
      }),
    ]);
    const monthKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).format(d);
    const months: { key: string; label: string; total: number }[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(yearAgo);
      d.setUTCMonth(d.getUTCMonth() + i);
      d.setUTCDate(15);
      months.push({ key: monthKey(d), label: new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: tz }).format(d), total: 0 });
    }
    const byMethod = new Map<string, number>();
    for (const p of payments) {
      const m = months.find((x) => x.key === monthKey(p.paidAt));
      if (m) m.total += p.amount;
      byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount);
    }
    return {
      thisMonth: months[months.length - 1]!.total,
      lastMonth: months[months.length - 2]!.total,
      outstanding: open.reduce((a, i) => a + i.total - i.amountPaid, 0),
      overdue: overdueInst.reduce((a, i) => a + Math.max(0, i.amount - i.paidAmount), 0),
      months,
      byMethod: [...byMethod.entries()].sort((a, b) => b[1] - a[1]),
    };
  });
}

export function listInstitutions(ctx: Ctx, opts: { includeInactive?: boolean; country?: string } = {}) {
  return db(ctx, (tx) =>
    tx.institution.findMany({
      where: { ...(opts.includeInactive ? {} : { active: true }), ...(opts.country ? { country: opts.country } : {}) },
      orderBy: [{ country: 'asc' }, { name: 'asc' }],
      include: { courses: { where: { active: true }, orderBy: { name: 'asc' } }, _count: { select: { applications: true } } },
    }),
  );
}

export function getInstitution(ctx: Ctx, id: string) {
  return db(ctx, (tx) =>
    tx.institution.findUnique({
      where: { id },
      include: {
        courses: { where: { active: true }, orderBy: { name: 'asc' } },
        applications: { orderBy: { updatedAt: 'desc' }, take: 100, include: { case: { include: { client: true } }, course: true } },
        claims: { orderBy: { createdAt: 'desc' } },
      },
    }),
  );
}

export function listClaims(ctx: Ctx, status?: string) {
  return db(ctx, (tx) =>
    tx.commissionClaim.findMany({
      where: status ? { status: status as ClaimStatus } : {},
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      take: 300,
      include: { institution: true, application: { include: { case: { include: { client: true } }, course: true } } },
    }),
  );
}

export function getDocumentQueue(ctx: Ctx) {
  return db(ctx, (tx) =>
    tx.document.findMany({
      where: { status: 'UPLOADED' },
      orderBy: { updatedAt: 'asc' },
      take: 50,
      include: { case: true, client: true },
    }),
  );
}
