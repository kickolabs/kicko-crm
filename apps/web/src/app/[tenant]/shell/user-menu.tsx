'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { LogOut, Plus, Repeat, UserCog } from 'lucide-react';
import type { Role } from '@kicko/db';
import { Avatar } from '@/components/ui';
import { ROLE_LABEL } from '@/lib/permissions';
import { signOutAction } from '../../(auth)/actions';

export function UserMenu({ slug, name, email, role }: { slug: string; name: string; email: string; role: Role }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account: ${name}`}
        className="flex h-11 items-center gap-2 rounded-[14px] bg-card pr-3 pl-1.5 shadow-[var(--shadow-card)]"
      >
        <Avatar name={name} size={32} />
        <span className="hidden text-sm font-semibold sm:block">{name.split(' ')[0]}</span>
      </button>
      {open && (
        <div role="menu" className="pop-in absolute top-[calc(100%+8px)] right-0 z-30 w-64 rounded-[16px] bg-card p-2 shadow-[var(--shadow-pop)]">
          <div className="px-3 py-2">
            <div className="truncate font-bold">{name}</div>
            <div className="truncate text-xs text-muted">{email}</div>
            <div className="mt-1.5 inline-block rounded-full bg-paper-2 px-2 py-0.5 text-[11px] font-bold">{ROLE_LABEL[role]}</div>
          </div>
          <div className="my-1 h-px bg-line" />
          <Link role="menuitem" href={`/account?from=${slug}`} className="flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm font-semibold hover:bg-paper-3">
            <UserCog size={15} aria-hidden="true" /> My account & security
          </Link>
          <Link role="menuitem" href={`/?choose=1&from=${slug}`} className="flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm font-semibold hover:bg-paper-3">
            <Repeat size={15} aria-hidden="true" /> Switch workspace
          </Link>
          <Link role="menuitem" href={`/signup?from=${slug}`} className="flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm font-semibold hover:bg-paper-3">
            <Plus size={15} aria-hidden="true" /> New agency workspace
          </Link>
          <form action={signOutAction}>
            <button role="menuitem" type="submit" className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-sm font-semibold text-danger hover:bg-danger-bg">
              <LogOut size={15} aria-hidden="true" /> Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
