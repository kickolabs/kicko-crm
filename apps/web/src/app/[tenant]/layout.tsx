import type { Metadata } from 'next';
import { dayBounds } from '@/lib/format';
import { scopeOf } from '@/server/scope';
import { tenantPack } from '@/server/library';
import { db, getCtx } from '@/lib/tenant';
import { can } from '@/lib/permissions';
import { agentStatus } from '@/server/copilot';
import { prisma } from '@kicko/db';
import { trialEligible } from '@/server/trial';
import { Sidebar } from './shell/sidebar';
import { CommandBar } from './shell/command-bar';
import { UserMenu } from './shell/user-menu';
import { PlanBanner, SuspendedScreen } from './shell/plan-banner';
import { PlanPicker } from './settings/plan-settings';
import type { Interval, PlanId } from '@/lib/plans';

export async function generateMetadata({ params }: { params: Promise<{ tenant: string }> }): Promise<Metadata> {
  const ctx = await getCtx((await params).tenant);
  return { title: { default: ctx.tenant.name, template: `%s · ${ctx.tenant.name}` } };
}

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: slug } = await params;
  const ctx = await getCtx(slug);
  const today = dayBounds(ctx.tenant.timezone);
  const counts = await db(ctx, async (tx) => {
    const [leads, cases, tasks, waiting, docs, inbox, missed] = await Promise.all([
      tx.lead.count({ where: { status: { notIn: ['WON', 'LOST'] } } }),
      tx.case.count({ where: { status: 'OPEN' } }),
      tx.task.count({ where: { done: false, assigneeId: ctx.user.id, dueAt: { lt: today.end } } }),
      tx.checkIn.count({ where: { status: 'WAITING' } }),
      can(ctx.role, 'document.verify') ? tx.document.count({ where: { status: 'UPLOADED' } }) : Promise.resolve(0),
      tx.message.groupBy({ by: ['clientId'], where: { direction: 'INBOUND', readAt: null } }).then((g) => g.length),
      tx.call.count({ where: { direction: 'INBOUND', status: { in: ['NO_ANSWER', 'BUSY', 'CANCELED'] }, startedAt: { gte: today.start } } }),
    ]);
    return { leads, cases, tasks, waiting, docs, inbox, missed };
  });

  const canManage = can(ctx.role, 'settings.manage');
  if (ctx.access === 'suspended') {
    const s = ctx.subscription!;
    const seatsUsed = await db(ctx, (tx) => tx.membership.count({ where: { active: true } }));
    return (
      <SuspendedScreen name={ctx.tenant.name}>
        {canManage ? (
          <PlanPicker
            slug={slug}
            sub={{
              plan: s.plan as PlanId, interval: s.interval as Interval, status: 'suspended', seats: Math.max(s.seats, seatsUsed), seatsUsed, trialDaysLeft: null,
              renews: null, cancelAtPeriodEnd: false, provider: s.provider, discountPct: s.discountPct, currency: ctx.tenant.country === 'IN' ? 'INR' : 'USD',
            }}
          />
        ) : undefined}
        {canManage && (
          <p className="text-sm text-muted">
            Need your records? <a href={`/api/t/${slug}/export`} className="font-semibold text-ink underline">Download all your data</a> (CSV files in a ZIP).
          </p>
        )}
      </SuspendedScreen>
    );
  }

  const agents = await agentStatus(ctx);
  // A workspace without a plan: the owner may still start the one free trial.
  const trial =
    ctx.subscription?.status === 'pending'
      ? (await prisma.trialReview.findFirst({ where: { tenantId: ctx.tenant.id, status: 'open' } }))
        ? ('review' as const)
        : ctx.role === 'OWNER' && (await trialEligible(ctx.user.id))
          ? ('available' as const)
          : null
      : null;

  return (
    <div className="dotgrid flex min-h-dvh flex-col lg:flex-row">
      <Sidebar
        slug={slug}
        tenantName={ctx.tenant.name}
        counts={counts}
        canSettings={can(ctx.role, 'settings.manage')}
        canBilling={can(ctx.role, 'billing.read')}
        agents={agents}
        organizations={(await tenantPack(scopeOf(ctx))).pack.labels.organizations ?? null}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-paper/85 px-4 py-3 backdrop-blur sm:px-7">
          <CommandBar slug={slug} ai={Boolean(agents)} />
          <UserMenu slug={slug} name={ctx.user.name} email={ctx.user.email} role={ctx.role} />
        </div>
        <PlanBanner slug={slug} sub={ctx.subscription} tz={ctx.tenant.timezone} canManage={canManage} trial={trial} />
        <main className="flex-1 px-4 pt-6 pb-16 sm:px-7">{children}</main>
      </div>
    </div>
  );
}
