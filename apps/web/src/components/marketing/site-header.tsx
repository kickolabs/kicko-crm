import Link from 'next/link';
import { Logo } from '@/components/logo';
import { LinkButton } from '@/components/ui';

export function SiteHeader() {
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5">
      <Link href="/" aria-label="Kicko home"><Logo /></Link>
      <nav aria-label="Site" className="flex items-center gap-1 sm:gap-2">
        <Link href="/#product" className="hidden rounded-[10px] px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-ink/5 sm:block">Product</Link>
        <Link href="/pricing" className="rounded-[10px] px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-ink/5">Pricing</Link>
        <Link href="/security" className="hidden rounded-[10px] px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-ink/5 md:block">Security</Link>
        <LinkButton href="/login" variant="ghost" className="hidden sm:inline-flex">Sign in</LinkButton>
        <LinkButton href="/signup" variant="primary">Start free</LinkButton>
      </nav>
    </header>
  );
}
