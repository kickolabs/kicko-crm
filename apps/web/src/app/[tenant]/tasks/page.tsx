import clsx from 'clsx';
import Link from 'next/link';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { dayBounds, fullName } from '@/lib/format';
import { getCtx, getTeam } from '@/lib/tenant';
import { listTasks } from '@/server/queries';
import { TaskRow } from '../_components/work-panels';
import { NewTaskButton } from './new-task-button';

export const metadata = { title: 'Tasks' };

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ scope?: string; show?: string }>;
}) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const scope = sp.scope === 'all' ? 'all' : 'mine';
  const show = sp.show === 'done' ? 'done' : 'open';
  const ctx = await getCtx(slug);
  const [tasks, team] = await Promise.all([listTasks(ctx, { scope, show }), getTeam(ctx)]);
  const names = Object.fromEntries(team.map((m) => [m.userId, m.name]));
  const tz = ctx.tenant.timezone;
  const today = dayBounds(tz);
  const week = dayBounds(tz, 7);

  const groups =
    show === 'done'
      ? [{ title: 'Completed', items: tasks }]
      : [
          { title: 'Overdue', items: tasks.filter((t) => t.dueAt && t.dueAt < today.start), tone: 'danger' },
          { title: 'Today', items: tasks.filter((t) => t.dueAt && t.dueAt >= today.start && t.dueAt < today.end) },
          { title: 'Next 7 days', items: tasks.filter((t) => t.dueAt && t.dueAt >= today.end && t.dueAt < week.start) },
          { title: 'Later', items: tasks.filter((t) => t.dueAt && t.dueAt >= week.start) },
          { title: 'No due date', items: tasks.filter((t) => !t.dueAt) },
        ].filter((g) => g.items.length);

  const tabs = [
    { label: 'My open', href: '?', active: scope === 'mine' && show === 'open' },
    { label: 'Team open', href: '?scope=all', active: scope === 'all' && show === 'open' },
    { label: 'Done', href: `?show=done${scope === 'all' ? '&scope=all' : ''}`, active: show === 'done' },
  ];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader title="Tasks" actions={<NewTaskButton slug={slug} team={team} me={ctx.user.id} />} />
      <div className="flex gap-1.5">
        {tabs.map((t) => (
          <Link key={t.label} href={t.href} className={clsx('rounded-full px-3.5 py-1.5 text-[13px] font-semibold', t.active ? 'bg-ink text-paper' : 'bg-card text-muted shadow-[var(--shadow-card)] hover:text-ink')}>
            {t.label}
          </Link>
        ))}
      </div>
      {groups.length === 0 && (
        <Card><EmptyState title={show === 'done' ? 'Nothing completed yet' : 'Inbox zero'} body="Tasks you add on leads, clients and cases collect here." /></Card>
      )}
      {groups.map((g) => (
        <Card key={g.title}>
          <div className="flex items-center gap-2 border-b border-line px-5 py-3">
            <h2 className={clsx('text-sm font-bold', g.tone === 'danger' && 'text-danger')}>{g.title}</h2>
            <span className="text-xs font-semibold text-muted">{g.items.length}</span>
          </div>
          <ul className="divide-y divide-line px-5">
            {g.items.map((t) => {
              const href = t.caseId ? `/${slug}/cases/${t.caseId}` : t.clientId ? `/${slug}/clients/${t.clientId}` : t.leadId ? `/${slug}/leads/${t.leadId}` : null;
              const label = t.case?.ref ?? (t.client ? fullName(t.client) : t.lead ? fullName(t.lead) : null);
              return (
                <TaskRow
                  key={t.id}
                  slug={slug}
                  task={t}
                  tz={tz}
                  assignee={scope === 'all' && t.assigneeId ? names[t.assigneeId] : undefined}
                  context={href && label ? { href, label } : undefined}
                />
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}
