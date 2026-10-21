'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  Inbox,
  Phone,
  Building2,
  FileCheck2,
  Receipt,
  CalendarDays,
  CheckSquare,
  DoorOpen,
  FolderKanban,
  LayoutGrid,
  Menu,
  Settings,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { LogoMark } from '@/components/logo';

type Counts = { leads: number; cases: number; tasks: number; waiting: number; docs: number; inbox: number; missed: number };

export function Sidebar({
  slug,
  tenantName,
  counts,
  canSettings,
  canBilling,
}: {
  slug: string;
  tenantName: string;
  counts: Counts;
  canSettings: boolean;
  canBilling: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const base = `/${slug}`;

  const items = [
    { href: base, label: 'Command', icon: LayoutGrid, exact: true },
    { href: `${base}/inbox`, label: 'Inbox', icon: Inbox, count: counts.inbox, hot: counts.inbox > 0 },
    { href: `${base}/calls`, label: 'Calls', icon: Phone, count: counts.missed, hot: counts.missed > 0 },
    { href: `${base}/leads`, label: 'Leads', icon: Users, count: counts.leads },
    { href: `${base}/clients`, label: 'Clients', icon: UserRound },
    { href: `${base}/cases`, label: 'Cases', icon: FolderKanban, count: counts.cases },
    { href: `${base}/documents`, label: 'Documents', icon: FileCheck2, count: counts.docs, hot: counts.docs > 0 },
    { href: `${base}/tasks`, label: 'Tasks', icon: CheckSquare, count: counts.tasks, hot: counts.tasks > 0 },
    { href: `${base}/calendar`, label: 'Calendar', icon: CalendarDays },
    { href: `${base}/walk-ins`, label: 'Walk-ins', icon: DoorOpen, count: counts.waiting, hot: counts.waiting > 0 },
  ];
  if (canBilling) items.push({ href: `${base}/billing`, label: 'Billing', icon: Receipt });
  items.push({ href: `${base}/partners`, label: 'Partners', icon: Building2 });
  if (canSettings) items.push({ href: `${base}/settings`, label: 'Settings', icon: Settings });

  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href));

  return (
    <>
      <div className="flex items-center justify-between border-b border-line bg-paper-2 px-4 py-3 lg:hidden">
        <Link href={base} className="flex items-center gap-2.5">
          <LogoMark size={28} />
          <span className="font-extrabold tracking-tight">{tenantName}</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Menu"
          className="flex h-10 w-10 items-center justify-center rounded-[10px] hover:bg-ink/5"
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>
      <nav
        aria-label="Primary"
        className={clsx(
          'shrink-0 flex-col gap-1 border-r border-line bg-paper-2 px-3.5 py-5 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-[232px]',
          open ? 'flex' : 'hidden',
        )}
      >
        <Link href={base} className="mb-4 hidden items-center gap-2.5 px-2.5 lg:flex">
          <LogoMark />
          <span className="flex min-w-0 flex-col">
            <span className="text-[15px] font-extrabold tracking-[-0.02em]">Kicko</span>
            <span className="truncate text-[11px] font-medium text-muted">{tenantName}</span>
          </span>
        </Link>
        {items.map(({ href, label, icon: Icon, count, hot, exact }) => {
          const active = isActive(href, exact);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 font-semibold transition-colors',
                active ? 'bg-ink text-paper' : 'text-muted hover:bg-ink/5 hover:text-ink',
              )}
            >
              <Icon size={16} strokeWidth={1.9} className={active ? 'text-lime' : undefined} aria-hidden="true" />
              {label}
              {count ? (
                <span
                  className={clsx(
                    'ml-auto rounded-full px-1.5 text-[11px] font-bold',
                    hot ? 'bg-lime text-ink' : active ? 'text-paper/70' : 'text-muted',
                  )}
                >
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
        <div className="mt-auto hidden rounded-[14px] bg-card p-3.5 text-xs leading-relaxed text-muted shadow-[var(--shadow-card)] lg:block">
          <span className="eyebrow mb-1 block">Coming next</span>
          Plans & subscriptions, admin console, CSV import.
        </div>
      </nav>
    </>
  );
}
