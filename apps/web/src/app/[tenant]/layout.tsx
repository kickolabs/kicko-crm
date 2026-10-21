import type { Metadata } from 'next';
import { dayBounds } from '@/lib/format';
import { db, getCtx } from '@/lib/tenant';
import { can } from '@/lib/permissions';
import { Sidebar } from './shell/sidebar';
import { CommandBar } from './shell/command-bar';
import { UserMenu } from './shell/user-menu';

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

  return (
    <div className="dotgrid flex min-h-dvh flex-col lg:flex-row">
      <Sidebar
        slug={slug}
        tenantName={ctx.tenant.name}
        counts={counts}
        canSettings={can(ctx.role, 'settings.manage')}
        canBilling={can(ctx.role, 'billing.read')}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-paper/85 px-4 py-3 backdrop-blur sm:px-7">
          <CommandBar slug={slug} />
          <UserMenu slug={slug} name={ctx.user.name} email={ctx.user.email} role={ctx.role} />
        </div>
        <main className="flex-1 px-4 pt-6 pb-16 sm:px-7">{children}</main>
      </div>
    </div>
  );
}
