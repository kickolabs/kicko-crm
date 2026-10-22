import Link from 'next/link';
import { tenantsForUser } from '@kicko/db/provision';
import { getSession } from '@/lib/auth';
import { SignUpForm } from '../auth-forms';

export const metadata = { title: 'Create your workspace' };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const session = await getSession();
  // Signed in and adding another agency: a way back to where they came from.
  const tenants = session ? await tenantsForUser(session.user.id) : [];
  const { from: fromSlug } = await searchParams;
  const from = tenants.find((t) => t.slug === fromSlug) ?? (tenants.length === 1 ? tenants[0] : undefined);
  const back = from ? { href: `/${from.slug}`, label: `Back to ${from.name}` } : tenants.length ? { href: '/?choose=1', label: 'Back to your workspaces' } : null;
  return (
    <div className="card pop-in w-full max-w-xl p-8">
      {back && (
        <Link href={back.href} className="mb-5 flex w-fit text-sm font-semibold text-muted hover:text-ink">
          ← {back.label}
        </Link>
      )}
      <span className="eyebrow">Kicko for consultancies</span>
      <h1 className="mt-2 text-[32px] leading-tight font-extrabold tracking-[-0.04em]">
        {session ? 'Add another agency.' : 'Set up your agency in a minute.'}
      </h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        {session
          ? `Signed in as ${session.user.email}. You'll be the owner of the new workspace.`
          : 'Comes with 25+ ready visa workflows across study, PR, work, visit and family. Edit them anytime.'}
      </p>
      <SignUpForm signedInAs={session?.user.email} />
    </div>
  );
}
