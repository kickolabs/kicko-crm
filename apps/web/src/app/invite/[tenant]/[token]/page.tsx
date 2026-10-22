import Link from 'next/link';
import { Logo } from '@/components/logo';
import { buttonCls } from '@/components/ui';
import { getSession } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/permissions';
import { getTenantBySlug } from '@/lib/tenant';
import { getInvite } from '@/server/team';
import { AcceptInvite, InviteSignUp } from './invite-forms';

export const metadata = { title: 'Join your team' };

export default async function InvitePage({ params }: { params: Promise<{ tenant: string; token: string }> }) {
  const { tenant: slug, token } = await params;
  const tenant = await getTenantBySlug(slug);
  const invite = tenant ? await getInvite(tenant.id, token) : null;
  const session = await getSession();

  return (
    <div className="dotgrid flex min-h-dvh flex-col">
      <header className="px-6 py-5"><Link href="/" aria-label="Kicko home" className="inline-flex"><Logo /></Link></header>
      <main className="flex flex-1 items-start justify-center px-4 pt-8 pb-16">
        <div className="card pop-in w-full max-w-md p-8">
          {!tenant || !invite ? (
            <>
              <h1 className="text-2xl font-extrabold tracking-tight">This invite isn't valid.</h1>
              <p className="mt-2 text-sm text-muted">It may have expired or been revoked. Ask your admin for a new link.</p>
              <Link href="/login" className={buttonCls('primary', 'md', 'mt-6')}>Go to sign in</Link>
            </>
          ) : (
            <>
              <span className="eyebrow">You're invited</span>
              <h1 className="mt-2 text-[30px] leading-tight font-extrabold tracking-[-0.04em]">Join {tenant.name} on Kicko</h1>
              <p className="mt-1 mb-6 text-sm text-muted">as {ROLE_LABEL[invite.role]} · {invite.email}</p>
              {session ? (
                <AcceptInvite slug={slug} token={token} signedInAs={session.user.email} matches={session.user.email.toLowerCase() === invite.email} />
              ) : (
                <InviteSignUp slug={slug} token={token} email={invite.email} />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
