import clsx from 'clsx';
import Link from 'next/link';
import { layoutDay } from '@/lib/calendar';

// Calendar views. Day and week are an hour grid (events sized by their length,
// overlapping ones side by side); month is a grid of days with the first few
// meetings in each. Phones get the same meetings as a list.

export type CalEvent = {
  id: string;
  ymd: string; // local date
  start: number; // minutes from local midnight
  end: number;
  time: string; // "11:00 am – 11:30 am"
  startLabel: string; // "11:00"
  who: string;
  title: string;
  mode: string;
  staff: string | null;
  cancelled: boolean;
  mine: boolean;
  href: string | null;
};

export type CalDay = { ymd: string; label: string; short: string; dayNum: number; isToday: boolean; inMonth: boolean; href: string };

const MODE: Record<string, string> = { IN_PERSON: 'Office', VIDEO: 'Video', PHONE: 'Phone' };

function EventCard({ e, compact, tiny }: { e: CalEvent; compact?: boolean; tiny?: boolean }) {
  // Too short for three lines: one line, the person first.
  const body = tiny ? (
    <div className="truncate text-[11px] leading-[14px]">
      <span className={clsx('font-semibold', e.cancelled && 'line-through')}>{e.who}</span>
      <span className="text-muted"> · {e.time.split(' – ')[0]} · {MODE[e.mode] ?? e.mode}</span>
    </div>
  ) : (
    <>
      <div className="truncate text-[11px] font-bold text-muted">
        {e.time} · {MODE[e.mode] ?? e.mode}
      </div>
      <div className={clsx('truncate text-[13px] font-semibold', e.cancelled && 'line-through')}>{e.who}</div>
      {!compact && <div className="truncate text-[11px] text-muted">{[e.title !== e.who ? e.title : null, e.staff].filter(Boolean).join(' · ')}</div>}
    </>
  );
  const cls = clsx(
    'block h-full overflow-hidden rounded-[6px] border-l-[3px] px-2 shadow-[0_0_0_1px_var(--color-line)]',
    tiny ? 'flex items-center py-0' : 'py-1',
    e.mine ? 'border-lime' : 'border-ink/25',
    e.cancelled ? 'bg-paper-2 opacity-60' : 'bg-card hover:bg-paper-3',
  );
  return e.href ? <Link href={e.href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** Hour grid for one day or a week, sized to fit the window: no scrolling. */
export function TimeGrid({ days, events, nowMin }: { days: CalDay[]; events: CalEvent[]; nowMin: number | null }) {
  const live = events.filter((e) => !e.cancelled);
  const first = Math.min(8, ...live.map((e) => Math.floor(e.start / 60)));
  const last = Math.max(20, ...live.map((e) => Math.ceil(e.end / 60)));
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  // Positions as a share of the grid's height, so the whole day fits whatever the window size.
  const span = (last - first) * 60;
  const pct = (min: number) => `${((min - first * 60) / span) * 100}%`;
  const hourLabel = (h: number) => new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: true, timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 0, 1, h)));

  return (
    <div className="card hidden overflow-hidden md:block">
      <div className="flex h-[calc(100dvh-248px)] min-h-[460px] flex-col">
        <div className="grid shrink-0" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
          {/* Day headings */}
          <div className="border-b border-line bg-card" />
          {days.map((d) => (
            <Link
              key={d.ymd}
              href={d.href}
              className={clsx('flex items-center justify-between border-b border-l border-line px-3 py-2.5 text-[13px] font-bold', d.isToday ? 'bg-lime' : 'bg-card hover:bg-paper-3')}
            >
              {d.label}
              <span className="text-xs font-semibold text-muted">{events.filter((e) => e.ymd === d.ymd && !e.cancelled).length || ''}</span>
            </Link>
          ))}
        </div>

        {/* Hours: the body takes the rest of the height */}
        <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
          <div className="relative">
            {hours.map((h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 text-[11px] font-semibold text-muted" style={{ top: pct(h * 60) }}>
                {h === first ? '' : hourLabel(h)}
              </span>
            ))}
          </div>
          {days.map((d) => {
            const placed = layoutDay(events.filter((e) => e.ymd === d.ymd));
            return (
              <div
                key={d.ymd}
                className={clsx('relative border-l border-line', d.isToday && 'bg-lime/[0.06]')}
                style={{ backgroundImage: `repeating-linear-gradient(to bottom, var(--color-line) 0 1px, transparent 1px calc(100% / ${hours.length}))` }}
              >
                {placed.map((e) => (
                  <div
                    key={e.id}
                    className="absolute p-[2px]"
                    style={{ top: pct(e.start), height: `${((e.end - e.start) / span) * 100}%`, left: `${(e.col / e.cols) * 100}%`, width: `${100 / e.cols}%` }}
                  >
                    <EventCard e={e} tiny={e.end - e.start < 50} compact={e.end - e.start < 90 || e.cols > 2} />
                  </div>
                ))}
                {d.isToday && nowMin !== null && nowMin >= first * 60 && nowMin <= last * 60 && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 flex -translate-y-1/2 items-center" style={{ top: pct(nowMin) }} aria-label="Now">
                    <span className="-ml-[5px] h-2.5 w-2.5 rounded-full bg-ink" />
                    <span className="h-[2px] flex-1 bg-ink" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Month: whole weeks, the first three meetings a day and "+N more". */
export function MonthGrid({ days, events }: { days: CalDay[]; events: CalEvent[] }) {
  const rows = days.length / 7;
  return (
    <div className="card flex h-[calc(100dvh-248px)] min-h-[460px] flex-col overflow-hidden">
      <div className="grid shrink-0 grid-cols-7 border-b border-line">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="px-3 py-2 text-[11px] font-bold tracking-wider text-muted uppercase">{d}</div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7" style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
        {days.map((d, i) => {
          const items = events.filter((e) => e.ymd === d.ymd);
          const shown = items.slice(0, 3);
          return (
            <div key={d.ymd} className={clsx('flex min-h-0 min-w-0 flex-col gap-1 overflow-hidden border-line p-1.5', i % 7 && 'border-l', i >= 7 && 'border-t', !d.inMonth && 'bg-paper-3/60')}>
              <Link
                href={d.href}
                aria-label={`${d.label}${items.length ? `, ${items.length} meeting${items.length === 1 ? '' : 's'}` : ''}`}
                className={clsx(
                  'flex h-6 w-6 items-center justify-center self-start rounded-full text-[12px] font-bold hover:bg-ink/5',
                  d.isToday && 'bg-lime hover:bg-lime',
                  !d.inMonth && 'text-faint',
                )}
              >
                {d.dayNum}
              </Link>
              {items.length > 0 && <span className="px-1 text-[11px] font-bold text-muted sm:hidden">{items.length}</span>}
              <ul className="hidden min-h-0 flex-col gap-0.5 sm:flex">
                {shown.map((e) => {
                  const cls = clsx('flex min-w-0 items-center gap-1.5 rounded-[6px] px-1.5 py-0.5 text-[11px] hover:bg-paper-2', e.cancelled && 'line-through opacity-60');
                  const body = (
                    <>
                      <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', e.mine ? 'bg-lime ring-1 ring-ink/40' : 'bg-ink/40')} aria-hidden="true" />
                      <span className="shrink-0 font-semibold text-muted">{e.startLabel}</span>
                      <span className="truncate font-semibold">{e.who}</span>
                    </>
                  );
                  return <li key={e.id}>{e.href ? <Link href={e.href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
                })}
                {items.length > 3 && (
                  <li>
                    <Link href={d.href} className="px-1.5 text-[11px] font-bold text-muted hover:text-ink">+{items.length - 3} more</Link>
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Phones: day and week as a list of meetings by day. */
export function AgendaList({ days, events }: { days: CalDay[]; events: CalEvent[] }) {
  return (
    <div className="flex flex-col gap-3 md:hidden">
      {days.map((d) => {
        const items = events.filter((e) => e.ymd === d.ymd);
        return (
          <section key={d.ymd} className={clsx('card overflow-hidden', d.isToday && 'shadow-[0_0_0_2px_var(--color-ink)]')} aria-label={d.label}>
            <div className={clsx('flex items-center justify-between px-3.5 py-2.5 text-[13px] font-bold', d.isToday && 'bg-lime')}>
              {d.label}
              {items.length > 0 && <span className="text-xs text-muted">{items.length}</span>}
            </div>
            {items.length === 0 ? (
              <p className="px-3.5 pb-3 text-xs text-muted">No meetings.</p>
            ) : (
              <ul className="flex flex-col gap-1.5 px-2 pb-2">
                {items.map((e) => <li key={e.id}><EventCard e={e} /></li>)}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Day view's side panel: the day's meetings with everything about them. */
export function DayAgenda({ day, events }: { day: CalDay; events: CalEvent[] }) {
  const items = events.filter((e) => e.ymd === day.ymd);
  return (
    <aside aria-label={`Meetings on ${day.label}`} className="card hidden h-[calc(100dvh-248px)] min-h-[460px] flex-col overflow-hidden md:flex">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-bold">Agenda</h2>
        <p className="text-xs text-muted">{items.filter((e) => !e.cancelled).length ? `${items.filter((e) => !e.cancelled).length} meeting${items.filter((e) => !e.cancelled).length === 1 ? '' : 's'}` : 'Nothing booked'}</p>
      </div>
      <ol className="flex flex-col divide-y divide-line overflow-y-auto">
        {items.map((e) => {
          const inner = (
            <>
              <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-muted">
                <span>{e.time}</span>
                <span>{MODE[e.mode] ?? e.mode}</span>
              </div>
              <div className={clsx('mt-0.5 font-bold', e.cancelled && 'line-through')}>{e.who}</div>
              {e.title !== e.who && <div className="text-[13px] text-ink-2">{e.title}</div>}
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                <span className={clsx('h-1.5 w-1.5 rounded-full', e.mine ? 'bg-lime ring-1 ring-ink/40' : 'bg-ink/40')} aria-hidden="true" />
                {e.staff ?? 'No one assigned'}
                {e.cancelled && ' · cancelled'}
              </div>
            </>
          );
          return (
            <li key={e.id}>
              {e.href ? <Link href={e.href} className="block px-4 py-3 hover:bg-paper-3">{inner}</Link> : <div className="px-4 py-3">{inner}</div>}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
