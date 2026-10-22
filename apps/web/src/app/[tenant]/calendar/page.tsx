import clsx from 'clsx';
import Link from 'next/link';
import { PageHeader, buttonCls } from '@/components/ui';
import { addDays, isYmd, step, viewDays, type CalView } from '@/lib/calendar';
import { fmtTime, fullName, parseLocal, toLocalInput } from '@/lib/format';
import { getCtx, getTeam } from '@/lib/tenant';
import { listAppointments } from '@/server/queries';
import { NewAppointmentButton } from '../tasks/new-task-button';
import { AgendaList, DayAgenda, MonthGrid, TimeGrid, type CalDay, type CalEvent } from './views';

export const metadata = { title: 'Calendar' };

const VIEWS: { key: CalView; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ view?: string; date?: string; mine?: string }>;
}) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const ctx = await getCtx(slug);
  const tz = ctx.tenant.timezone;
  const view: CalView = sp.view === 'day' || sp.view === 'month' ? sp.view : 'week';
  const today = toLocalInput(new Date(), tz, true);
  const date = isYmd(sp.date) ? sp.date : today;

  const ymds = viewDays(view, date);
  const from = parseLocal(ymds[0], tz)!;
  const to = parseLocal(addDays(ymds.at(-1)!, 1), tz)!;
  const [appts, team] = await Promise.all([listAppointments(ctx, from, to), getTeam(ctx)]);
  const names = Object.fromEntries(team.map((m) => [m.userId, m.name]));
  const visible = sp.mine ? appts.filter((a) => a.staffId === ctx.user.id) : appts;

  const q = (patch: Record<string, string | undefined>) =>
    `?${new URLSearchParams(Object.entries({ view: view === 'week' ? undefined : view, date: date === today ? undefined : date, mine: sp.mine, ...patch }).filter(([, v]) => v) as [string, string][])}`;
  const fmt = (ymd: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-IN', { ...o, timeZone: 'UTC' }).format(new Date(`${ymd}T12:00:00Z`));

  const days: CalDay[] = ymds.map((ymd) => ({
    ymd,
    label: fmt(ymd, view === 'day' ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' }),
    short: fmt(ymd, { weekday: 'short' }),
    dayNum: Number(ymd.slice(8)),
    isToday: ymd === today,
    inMonth: ymd.slice(0, 7) === date.slice(0, 7),
    href: q({ view: 'day', date: ymd === today ? undefined : ymd }),
  }));

  const minutes = (d: Date) => {
    const [h, m] = toLocalInput(d, tz).slice(11, 16).split(':').map(Number);
    return h! * 60 + m!;
  };
  const events: CalEvent[] = visible.map((a) => {
    const ymd = toLocalInput(a.startsAt, tz, true);
    const start = minutes(a.startsAt);
    const sameDay = toLocalInput(a.endsAt, tz, true) === ymd;
    const who = a.client ? fullName(a.client) : a.lead ? fullName(a.lead) : a.title;
    return {
      id: a.id,
      ymd,
      start,
      end: sameDay ? Math.max(start + 15, minutes(a.endsAt)) : 24 * 60,
      time: `${fmtTime(a.startsAt, tz)} – ${fmtTime(a.endsAt, tz)}`,
      startLabel: toLocalInput(a.startsAt, tz).slice(11, 16),
      who,
      title: a.title,
      mode: a.mode,
      staff: a.staffId ? (names[a.staffId] ?? null) : null,
      cancelled: a.status === 'CANCELLED',
      mine: a.staffId === ctx.user.id,
      href: a.caseId ? `/${slug}/cases/${a.caseId}` : a.clientId ? `/${slug}/clients/${a.clientId}` : a.leadId ? `/${slug}/leads/${a.leadId}` : null,
    };
  });

  const title =
    view === 'day'
      ? fmt(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : view === 'week'
        ? `${fmt(ymds[0]!, { day: 'numeric', month: 'short' })} – ${fmt(ymds[6]!, { day: 'numeric', month: 'short', year: 'numeric' })}`
        : fmt(date, { month: 'long', year: 'numeric' });
  const count = events.filter((e) => !e.cancelled && (view !== 'month' || e.ymd.slice(0, 7) === date.slice(0, 7))).length;
  const unit = view === 'day' ? 'day' : view;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Calendar"
        sub={`${title} · ${count} meeting${count === 1 ? '' : 's'}`}
        actions={
          <>
            <nav aria-label="Calendar view" className="flex rounded-[12px] bg-card p-1 shadow-[var(--shadow-card)]">
              {VIEWS.map((v) => (
                <Link
                  key={v.key}
                  href={q({ view: v.key === 'week' ? undefined : v.key })}
                  aria-current={view === v.key ? 'page' : undefined}
                  className={clsx('rounded-[9px] px-3.5 py-1.5 text-[13px] font-semibold', view === v.key ? 'bg-ink text-paper' : 'text-muted hover:text-ink')}
                >
                  {v.label}
                </Link>
              ))}
            </nav>
            <div className="flex gap-1.5">
              <Link href={q({ date: step(view, date, -1) })} className={buttonCls('secondary', 'md')} aria-label={`Previous ${unit}`}>←</Link>
              <Link href={q({ date: undefined })} className={buttonCls(date === today ? 'secondary' : 'primary', 'md')}>Today</Link>
              <Link href={q({ date: step(view, date, 1) })} className={buttonCls('secondary', 'md')} aria-label={`Next ${unit}`}>→</Link>
            </div>
            <Link href={q({ mine: sp.mine ? undefined : '1' })} className={buttonCls(sp.mine ? 'primary' : 'secondary', 'md')}>Only mine</Link>
            <NewAppointmentButton slug={slug} team={team} me={ctx.user.id} />
          </>
        }
      />
      {view === 'month' ? (
        <MonthGrid days={days} events={events} />
      ) : (
        <>
          {view === 'day' ? (
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_340px]">
              <TimeGrid days={days} events={events} nowMin={days[0]!.isToday ? minutes(new Date()) : null} />
              <DayAgenda day={days[0]!} events={events} />
            </div>
          ) : (
            <TimeGrid days={days} events={events} nowMin={days.some((d) => d.isToday) ? minutes(new Date()) : null} />
          )}
          <AgendaList days={days} events={events} />
        </>
      )}
    </div>
  );
}
