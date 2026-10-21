import Link from 'next/link';
import { redirect } from 'next/navigation';
import { tenantsForUser } from '@kicko/db/provision';
import { MarketingHome } from '@/components/marketing/home';
import { buttonCls } from '@/components/ui';
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

  return <MarketingHome />;
}
