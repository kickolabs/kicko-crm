import Link from 'next/link';
import { LogoMark } from '@/components/logo';
import { logoutAction } from './actions';

export function PortalShell({
  slug,
  agency,
  active,
  unread = 0,
  children,
}: {
  slug: string;
  agency: string;
  active: 'journey' | 'messages' | 'book';
  unread?: number;
  children: React.ReactNode;
}) {
  const tabs = [
    { key: 'journey', label: 'Journey', href: `/portal/${slug}` },
    { key: 'messages', label: 'Messages', href: `/portal/${slug}/messages`, badge: unread },
    { key: 'book', label: 'Book a meeting', href: `/portal/${slug}/book` },
  ] as const;
  return (
    <div className="min-h-dvh bg-paper">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-7 px-4 pt-6 pb-16 sm:px-6">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <Link href={`/portal/${slug}`} className="flex items-center gap-3">
            <LogoMark size={30} />
            <span className="font-bold">{agency}</span>
          </Link>
          <span className="text-xs font-semibold tracking-wide text-muted uppercase">Client portal</span>
          <nav aria-label="Portal" className="ml-auto flex flex-wrap items-center gap-1 text-sm">
            {tabs.map((t) => (
              <Link
                key={t.key}
                href={t.href}
                aria-current={active === t.key ? 'page' : undefined}
                className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 font-semibold ${active === t.key ? 'bg-ink text-paper' : 'text-muted hover:text-ink'}`}
              >
                {t.label}
                {'badge' in t && t.badge ? <span className="rounded-full bg-lime px-1.5 text-[11px] font-bold text-ink">{t.badge}</span> : null}
              </Link>
            ))}
            <form action={logoutAction.bind(null, slug)}>
              <button className="rounded-full px-3 py-2 font-semibold text-muted hover:text-ink">Sign out</button>
            </form>
          </nav>
        </header>
        {children}
        <footer className="pt-6 text-center text-xs text-muted">
          Your documents are private to you and {agency}. Visa decisions are made by the immigration authority.
        </footer>
      </div>
    </div>
  );
}
