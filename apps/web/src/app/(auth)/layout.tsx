import Link from 'next/link';
import { Logo } from '@/components/logo';
import { SiteFooter } from '@/components/site-footer';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dotgrid flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-6 py-5">
        <Link href="/" aria-label="Kicko home">
          <Logo />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:pt-14">{children}</main>
      <SiteFooter />
    </div>
  );
}
