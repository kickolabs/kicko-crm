import Link from 'next/link';
import { company } from '@/lib/company';

export function SiteFooter() {
  const c = company();
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-6 py-6 text-xs text-muted">
        <span>© {new Date().getFullYear()} {c.legalName}</span>
        <Link href="/terms" className="hover:text-ink">Terms</Link>
        <Link href="/privacy" className="hover:text-ink">Privacy</Link>
        <Link href="/dpa" className="hover:text-ink">Data Processing Agreement</Link>
        <Link href="/security" className="hover:text-ink">Security</Link>
        <a href={`mailto:${c.supportEmail}`} className="ml-auto hover:text-ink">{c.supportEmail}</a>
      </div>
    </footer>
  );
}
