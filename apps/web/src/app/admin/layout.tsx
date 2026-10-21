import Link from 'next/link';
import type { ReactNode } from 'react';
import { LogoMark } from '@/components/logo';
import { requireAdmin } from '@/server/admin';

export const metadata = { title: { default: 'Kicko admin', template: '%s · Kicko admin' }, robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 flex items-center gap-3 bg-ink px-5 py-3 text-paper">
        <Link href="/admin" className="flex items-center gap-2.5">
          <LogoMark size={28} />
          <span className="font-bold">Kicko</span>
          <span className="rounded bg-lime px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-ink">ADMIN</span>
        </Link>
        <span className="ml-auto text-xs text-paper/60">{admin.email}</span>
      </header>
      <main className="mx-auto flex max-w-[1280px] flex-col gap-5 px-5 py-6">{children}</main>
    </div>
  );
}
