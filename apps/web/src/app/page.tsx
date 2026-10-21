import Link from 'next/link';
import { redirect } from 'next/navigation';
import { tenantsForUser } from '@kicko/db/provision';
import { Logo } from '@/components/logo';
import { buttonCls, LinkButton } from '@/components/ui';
import { getSession } from '@/lib/auth';
import { getAdmin } from '@/server/admin';

export default async function Home() {
  const session = await getSession();
  if (session) {
    const tenants = await tenantsForUser(session.user.id);
    if (tenants.length === 1) redirect(`/${tenants[0]!.slug}`);
    if (tenants.length > 1) {
      return (
        <div className="dotgrid flex min-h-dvh items-start justify-center px-4 pt-20">
          <div className="card w-full max-w-md p-8">
            <h1 className="text-2xl font-extrabold tracking-tight">Choose a workspace</h1>
            <ul className="mt-5 flex flex-col gap-2">
              {tenants.map((t) => (
                <li key={t.id}>
                  <Link href={`/${t.slug}`} className="flex items-center justify-between rounded-[12px] px-4 py-3 font-semibold shadow-[inset_0_0_0_1px_var(--color-line-2)] hover:shadow-[inset_0_0_0_1px_var(--color-ink)]">
                    {t.name}
                    <span className="text-xs font-medium text-muted">/{t.slug}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <Link href="/signup" className={buttonCls('ghost', 'md', 'mt-4 w-full')}>
              + New agency workspace
            </Link>
          </div>
        </div>
      );
    }
    // Kicko staff accounts have no workspace: they land in the console.
    redirect((await getAdmin()) ? '/admin' : '/signup');
  }

  return (
    <div className="dotgrid min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <LinkButton href="/login" variant="ghost">
            Sign in
          </LinkButton>
          <LinkButton href="/signup" variant="primary">
            Start free
          </LinkButton>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 pt-16 pb-24">
        <span className="inline-flex items-center gap-2 rounded-full bg-card px-3 py-1 text-xs font-bold shadow-[var(--shadow-card)]">
          <span className="live-dot h-2 w-2 rounded-full bg-[#8DC21F]" />
          Built for visa & immigration consultancies
        </span>
        <h1 className="mt-6 max-w-4xl text-[44px] leading-[1.02] font-extrabold tracking-[-0.045em] sm:text-[72px]">
          Every enquiry, case and deadline. <span className="text-faint">One calm console.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-2">
          Capture leads from your website, walk-ins and calls, convert them to clients, and move every study, PR, work,
          visit and family case through its stages without spreadsheets.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <LinkButton href="/signup" variant="primary" size="lg">
            Create your workspace →
          </LinkButton>
          <LinkButton href="/login" variant="secondary" size="lg">
            I already have one
          </LinkButton>
        </div>
        <div className="mt-20 grid gap-4 sm:grid-cols-3">
          {[
            ['Leads that never slip', 'Web form, kiosk and manual capture, duplicate detection and fair auto-assignment.'],
            ['Cases with real stages', '25+ visa workflows, from CAS and GIC to ITA and COPR, editable per agency.'],
            ['Your agency, isolated', 'Every workspace is sealed at the database level. Your data is only ever yours.'],
          ].map(([t, b]) => (
            <div key={t} className="card p-6">
              <h2 className="text-base font-bold">{t}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{b}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
