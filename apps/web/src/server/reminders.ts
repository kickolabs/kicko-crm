import 'server-only';
import { prisma, withTenant, type Tx } from '@kicko/db';
import { fmtDate, fullName } from '@/lib/format';
import { systemScope, type Scope } from './scope';
import { formatMoney } from '@/lib/money';

// Daily job (Vercel Cron → /api/cron/daily). Turns time-based risks into tasks
// so they show up in the owner's queue. Safe to run more than once a day.

const DAY = 86400_000;

async function openTaskExists(tx: Tx, title: string) {
  return (await tx.task.count({ where: { title, done: false } })) > 0;
}

async function remindTenant(scope: Scope) {
  const { tenantId, timezone: tz } = scope;
  const overdueNotices: { clientId: string; caseId: string | null; vars: string[] }[] = [];
  const created = await withTenant(tenantId, async (tx) => {
    const now = new Date();
    let created = 0;

    // 1. Overdue installments, at most one reminder per installment per week.
    const overdue = await tx.installment.findMany({
      where: {
        dueDate: { lt: now },
        invoice: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
        OR: [{ reminded: null }, { reminded: { lt: new Date(now.getTime() - 7 * DAY) } }],
      },
      include: { invoice: { include: { client: true } } },
    });
    for (const inst of overdue.filter((i) => i.paidAmount < i.amount)) {
      const inv = inst.invoice;
      await tx.task.create({
        data: {
          tenantId,
          title: `Payment overdue: ${inv.ref} · ${inst.label} · ${formatMoney(inst.amount - inst.paidAmount, inv.currency)}`,
          dueAt: now,
          priority: 1,
          assigneeId: inv.client.ownerId ?? inv.createdBy,
          clientId: inv.clientId,
          caseId: inv.caseId,
        },
      });
      await tx.installment.update({ where: { id: inst.id }, data: { reminded: now } });
      overdueNotices.push({
        clientId: inv.clientId,
        caseId: inv.caseId,
        vars: [inv.client.firstName, formatMoney(inst.amount - inst.paidAmount, inv.currency), fmtDate(inst.dueDate, tz)],
      });
      created++;
    }

    // 2. Verified documents expiring within 60 days on open cases.
    const expiring = await tx.document.findMany({
      where: { status: 'VERIFIED', expiresAt: { gte: now, lt: new Date(now.getTime() + 60 * DAY) }, case: { status: { not: 'CLOSED' } } },
      include: { case: true, client: true },
    });
    for (const d of expiring) {
      const title = `${d.name} expires soon: ${fullName(d.client)} (${d.case.ref})`;
      if (await openTaskExists(tx, title)) continue;
      await tx.task.create({
        data: { tenantId, title, dueAt: now, priority: 1, assigneeId: d.case.ownerId, clientId: d.clientId, caseId: d.caseId },
      });
      created++;
    }

    // 3. Passports expiring within 6 months for clients with active cases.
    const passports = await tx.client.findMany({
      where: { passportExpiry: { gte: now, lt: new Date(now.getTime() + 180 * DAY) }, cases: { some: { status: 'OPEN' } } },
    });
    for (const c of passports) {
      const title = `Passport renewal: ${fullName(c)} (${c.ref})`;
      if (await openTaskExists(tx, title)) continue;
      await tx.task.create({ data: { tenantId, title, dueAt: now, assigneeId: c.ownerId, clientId: c.id } });
      created++;
    }
    return created;
  });

  // WhatsApp payment reminders go out after the reminder tasks are saved.
  if (overdueNotices.length) {
    const { fireAutomation } = await import('./whatsapp/automations');
    for (const n of overdueNotices) await fireAutomation(scope, 'PAYMENT_OVERDUE', n);
  }
  return created;
}

export async function runDailyReminders() {
  const tenants = await prisma.tenant.findMany();
  const results: Record<string, number | string> = {};
  for (const t of tenants) {
    try {
      const scope = systemScope(t);
      results[t.slug] = await remindTenant(scope);
    } catch (err) {
      console.error('reminders', t.slug, err);
      results[t.slug] = 'error';
    }
  }
  return results;
}
