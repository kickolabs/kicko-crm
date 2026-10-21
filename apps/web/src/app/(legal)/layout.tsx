import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';
import { SiteFooter } from '@/components/site-footer';

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
        <Link href="/" aria-label="Kicko home"><Logo /></Link>
        <nav className="flex gap-4 text-sm font-semibold text-muted">
          <Link href="/terms" className="hover:text-ink">Terms</Link>
          <Link href="/privacy" className="hover:text-ink">Privacy</Link>
          <Link href="/dpa" className="hover:text-ink">DPA</Link>
          <Link href="/security" className="hover:text-ink">Security</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-6 pt-6 pb-16">
        <article className="legal flex flex-col gap-4 text-[15px] leading-relaxed text-ink-2 [&_h1]:text-[40px] [&_h1]:leading-tight [&_h1]:font-extrabold [&_h1]:tracking-[-0.04em] [&_h1]:text-ink [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_a]:font-semibold [&_a]:text-ink [&_a]:underline [&_table]:w-full [&_table]:text-sm [&_td]:border-t [&_td]:border-line [&_td]:py-2 [&_td]:pr-3 [&_td]:align-top [&_th]:pb-2 [&_th]:pr-3 [&_th]:text-left [&_th]:text-xs [&_th]:uppercase [&_th]:text-muted">
          {children}
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
