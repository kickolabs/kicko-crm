'use client';

import clsx from 'clsx';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { markNotificationsReadAction } from '../actions';

type Item = { id: string; kind: string; text: string; href: string | null; readAt: string | null; createdAt: string };

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

/** Mentions, assignments, automation notices and stage deadlines. */
export function NotificationBell({ slug, items, unread }: { slug: string; items: Item[]; unread: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative grid size-10 place-items-center rounded-[12px] text-ink-2 hover:bg-paper-2"
      >
        <Bell size={18} />
        {unread > 0 && <span className="absolute top-1.5 right-1.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] leading-4 font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="pop-in absolute right-0 z-30 mt-2 w-[min(92vw,380px)] rounded-[18px] bg-card shadow-[var(--shadow-pop)]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-sm font-bold">Notifications</span>
            {unread > 0 && (
              <button type="button" onClick={() => markNotificationsReadAction(slug)} className="text-xs font-semibold text-muted hover:text-ink">Mark all read</button>
            )}
          </div>
          <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">You're all caught up.</li>}
            {items.map((n) => {
              const body = (
                <span className="flex gap-2.5">
                  <span className={clsx('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-lime ring-2 ring-lime/30')} aria-hidden="true" />
                  <span className="min-w-0 flex-1 text-sm text-ink-2">{n.text}</span>
                  <span className="shrink-0 text-xs text-faint">{ago(n.createdAt)}</span>
                </span>
              );
              return (
                <li key={n.id}>
                  {n.href ? (
                    <Link href={n.href} onClick={() => { setOpen(false); if (!n.readAt) void markNotificationsReadAction(slug, n.id); }} className="block px-4 py-3 hover:bg-paper-3">{body}</Link>
                  ) : (
                    <div className="px-4 py-3">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
