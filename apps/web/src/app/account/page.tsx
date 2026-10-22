import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@kicko/db';
import { tenantsForUser, type TenantSettings } from '@kicko/db/provision';
import { LogoMark } from '@/components/logo';
import { Card, CardHeader } from '@/components/ui';
import { auth, getSession } from '@/lib/auth';
import { displayIp, relative } from '@/lib/format';
import { deviceName } from '@/server/audit';
import { adminEmails } from '@/server/admin';
import { signOutAction } from '../(auth)/actions';
import { PasswordForm, SessionsList, TwoFactorCard } from './account-forms';

export const metadata = { title: 'My account' };
export const dynamic = 'force-dynamic';

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ required?: string; admin?: string; from?: string }> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect('/login?next=/account');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { name: true, email: true, twoFactorEnabled: true } });
  const [tenants, sessions] = await Promise.all([tenantsForUser(session.user.id), auth.api.listSessions({ headers: await headers() })]);
  const requiredBy = tenants.filter((t) => (t.settings as TenantSettings).security?.require2fa);
  const isAdmin = adminEmails().includes(user.email.toLowerCase());
  const enabled = Boolean(user.twoFactorEnabled);
  const blockedFrom = !enabled ? (requiredBy.find((t) => t.slug === sp.required) ?? (sp.admin ? { name: 'The Kicko admin console' } : null)) : null;

  return (
    <div className="min-h-dvh">
      <header className="flex items-center gap-3 border-b border-line px-5 py-3">
        <Link href="/" className="flex items-center gap-2.5"><LogoMark size={28} /><span className="font-bold">Kicko</span></Link>
        <span className="ml-auto text-xs text-muted">{user.email}</span>
        <form action={signOutAction}><button type="submit" className="rounded-[9px] px-2.5 py-1 text-xs font-semibold text-muted hover:bg-ink/5 hover:text-ink">Sign out</button></form>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-5 px-5 py-8">
        {(() => {
          const from = tenants.find((t) => t.slug === sp.from) ?? (tenants.length === 1 ? tenants[0] : undefined);
          const back = from ? { href: `/${from.slug}`, label: `Back to ${from.name}` } : tenants.length ? { href: '/?choose=1', label: 'Back to your workspaces' } : isAdmin ? { href: '/admin', label: 'Back to Kicko admin' } : null;
          return back && <Link href={back.href} className="-mb-2 self-start text-sm font-semibold text-muted hover:text-ink">← {back.label}</Link>;
        })()}
        <div>
          <h1 className="text-[34px] leading-tight font-extrabold tracking-[-0.04em]">My account</h1>
          <p className="text-sm text-muted">{user.name} · {user.email}</p>
        </div>

        {blockedFrom && (
          <p role="alert" className="rounded-[14px] bg-warn-bg px-4 py-3 text-sm font-semibold text-warn-ink">
            {blockedFrom.name} requires two-step sign-in. Set it up below to continue.
          </p>
        )}

        <Card>
          <CardHeader title="Two-step sign-in" sub={requiredBy.length ? `Required by ${requiredBy.map((t) => t.name).join(', ')}` : isAdmin ? 'Required for the Kicko admin console' : 'Recommended for everyone who handles client documents'} />
          <div className="px-5 py-4"><TwoFactorCard enabled={enabled} required={requiredBy.length > 0 || isAdmin} /></div>
        </Card>

        <Card>
          <CardHeader title="Password" />
          <div className="px-5 py-4"><PasswordForm /></div>
        </Card>

        <Card>
          <CardHeader title="Where you’re signed in" />
          <div className="px-5 py-2">
            <SessionsList
              sessions={sessions
                .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
                .map((s) => ({ id: s.id, device: deviceName(s.userAgent), ip: displayIp(s.ipAddress), when: relative(s.createdAt), current: s.id === session.session.id }))}
            />
          </div>
        </Card>

        {(tenants.length > 0 || isAdmin) && (
          <div className="flex flex-wrap gap-2 text-sm">
            {tenants.map((t) => <Link key={t.id} href={`/${t.slug}`} className="rounded-full px-3 py-1.5 font-semibold shadow-[inset_0_0_0_1px_var(--color-line-2)] hover:shadow-[inset_0_0_0_1px_var(--color-ink)]">← {t.name}</Link>)}
            {isAdmin && <Link href="/admin" className="rounded-full px-3 py-1.5 font-semibold shadow-[inset_0_0_0_1px_var(--color-line-2)] hover:shadow-[inset_0_0_0_1px_var(--color-ink)]">Kicko admin</Link>}
          </div>
        )}
      </main>
    </div>
  );
}
