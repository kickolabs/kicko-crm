import Link from 'next/link';
import { redirect } from 'next/navigation';
import { tenantsForUser } from '@kicko/db/provision';
import { MarketingHome } from '@/components/marketing/home';
import { buttonCls } from '@/components/ui';
import { getSession } from '@/lib/auth';
import { getAdmin } from '@/server/admin';
import { signOutAction } from './(auth)/actions';

export default async function Home({ searchParams }: { searchParams: Promise<{ choose?: string; from?: string }> }) {
  const session = await getSession();
  if (session) {
    const tenants = await tenantsForUser(session.user.id);
    // "Switch workspace" asks for the list (?choose=1) even with one workspace, so it never just reloads the same page.
    const sp = await searchParams;
    const choose = sp.choose === '1';
    const from = tenants.find((t) => t.slug === sp.from);
    if (tenants.length === 1 && !choose) redirect(`/${tenants[0]!.slug}`);
    if (tenants.length > 1 || (choose && tenants.length === 1)) {
      return (
        <div className="dotgrid flex min-h-dvh items-start justify-center px-4 pt-20">
          <div className="card w-full max-w-md p-8">
            {from && (
              <Link href={`/${from.slug}`} className="mb-4 flex w-fit text-sm font-semibold text-muted hover:text-ink">
                ← Back to {from.name}
              </Link>
            )}
            <h1 className="text-2xl font-extrabold tracking-tight">Choose a workspace</h1>
            {tenants.length === 1 && (
              <p className="mt-2 text-sm text-muted">You belong to one agency. Create another, or ask an agency to invite {session.user.email}, and it will show here.</p>
            )}
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
            <Link href={from ? `/signup?from=${from.slug}` : '/signup'} className={buttonCls('ghost', 'md', 'mt-4 w-full')}>
              + New agency workspace
            </Link>
            <div className="mt-4 flex items-center justify-center gap-4 border-t border-line pt-4 text-sm">
              <Link href={from ? `/account?from=${from.slug}` : '/account'} className="font-semibold text-muted hover:text-ink">My account</Link>
              <form action={signOutAction}>
                <button type="submit" className="font-semibold text-muted hover:text-ink">Sign out</button>
              </form>
            </div>
          </div>
        </div>
      );
    }
    // Kicko staff accounts have no workspace: they land in the console.
    redirect((await getAdmin()) ? '/admin' : '/signup');
  }

  return <MarketingHome />;
}
