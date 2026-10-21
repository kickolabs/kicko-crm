import clsx from 'clsx';
import Link from 'next/link';
import { Card, PageHeader, buttonCls } from '@/components/ui';
import { dayBounds, fmtTime, fullName, parseLocal, toLocalInput } from '@/lib/format';
import { getCtx, getTeam } from '@/lib/tenant';
import { listAppointments } from '@/server/queries';
import { NewAppointmentButton } from '../tasks/new-task-button';

export const metadata = { title: 'Calendar' };

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ week?: string; mine?: string }>;
}) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const ctx = await getCtx(slug);
  const tz = ctx.tenant.timezone;
  const offset = Number.parseInt(sp.week ?? '0', 10) || 0;

  // Week starts Monday, in the agency's timezone.
  const today = dayBounds(tz);
  const weekday = (new Date(toLocalInput(today.start, tz, true) + 'T12:00:00Z').getUTCDay() + 6) % 7;
  const start = new Date(today.start.getTime() - weekday * 86400_000 + offset * 7 * 86400_000);
  const end = new Date(start.getTime() + 7 * 86400_000);

  const [appts, team] = await Promise.all([listAppointments(ctx, start, end), getTeam(ctx)]);
  const names = Object.fromEntries(team.map((m) => [m.userId, m.name]));
  const visible = sp.mine ? appts.filter((a) => a.staffId === ctx.user.id) : appts;

  const days = Array.from({ length: 7 }, (_, i) => {
    const dStart = new Date(start.getTime() + i * 86400_000);
    const local = toLocalInput(dStart, tz, true);
    // Next local midnight (handles DST shifts in agencies outside India).
    const dEnd = parseLocal(toLocalInput(new Date(dStart.getTime() + 26 * 3600_000), tz, true), tz)!;
    return {
      key: local,
      label: new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(dStart.getTime() + 3600_000)),
      isToday: dStart.getTime() === today.start.getTime(),
      items: visible.filter((a) => a.startsAt >= dStart && a.startsAt < dEnd),
    };
  });
  const rangeLabel = `${days[0]!.label} – ${days[6]!.label}`;
  const q = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ week: offset ? String(offset) : undefined, mine: sp.mine, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `?${p}`;
  };

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <PageHeader
        title="Calendar"
        sub={rangeLabel}
        actions={
          <>
            <Link href={q({ week: String(offset - 1) })} className={buttonCls('secondary', 'md')} aria-label="Previous week">←</Link>
            <Link href={q({ week: undefined })} className={buttonCls('secondary', 'md')}>This week</Link>
            <Link href={q({ week: String(offset + 1) })} className={buttonCls('secondary', 'md')} aria-label="Next week">→</Link>
            <Link href={q({ mine: sp.mine ? undefined : '1' })} className={buttonCls(sp.mine ? 'primary' : 'secondary', 'md')}>Only mine</Link>
            <NewAppointmentButton slug={slug} team={team} me={ctx.user.id} />
          </>
        }
      />
      <div className="grid gap-3 md:grid-cols-7">
        {days.map((d) => (
          <Card key={d.key} className={clsx('flex min-h-48 flex-col', d.isToday && 'shadow-[0_0_0_2px_var(--color-ink)]')}>
            <div className={clsx('flex items-center justify-between rounded-t-[var(--radius-card)] px-3.5 py-2.5 text-[13px] font-bold', d.isToday && 'bg-lime')}>
              {d.label}
              {d.items.length > 0 && <span className="text-xs text-muted">{d.items.length}</span>}
            </div>
            <ul className="flex flex-1 flex-col gap-1.5 p-2">
              {d.items.map((a) => {
                const who = a.client ? fullName(a.client) : a.lead ? fullName(a.lead) : null;
                const href = a.caseId ? `/${slug}/cases/${a.caseId}` : a.clientId ? `/${slug}/clients/${a.clientId}` : a.leadId ? `/${slug}/leads/${a.leadId}` : null;
                const body = (
                  <>
                    <div className="text-[11px] font-bold text-muted">{fmtTime(a.startsAt, tz)} · {a.mode === 'IN_PERSON' ? 'Office' : a.mode === 'VIDEO' ? 'Video' : 'Phone'}</div>
                    <div className={clsx('text-[13px] font-semibold', a.status === 'CANCELLED' && 'line-through')}>{who ?? a.title}</div>
                    <div className="truncate text-[11px] text-muted">{who ? a.title : ''}{a.staffId && names[a.staffId] ? ` · ${names[a.staffId]}` : ''}</div>
                  </>
                );
                return (
                  <li key={a.id} className={clsx('rounded-[10px] px-2.5 py-2', a.status === 'SCHEDULED' ? 'bg-paper-3' : 'bg-paper-2 opacity-70')}>
                    {href ? <Link href={href} className="block hover:underline">{body}</Link> : body}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
