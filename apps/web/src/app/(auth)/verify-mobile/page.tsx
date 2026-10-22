import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { prisma, withTenant } from '@kicko/db';
import { tenantsForUser, TRIAL_DAYS } from '@kicko/db/provision';
import { buttonCls } from '@/components/ui';
import { getSession } from '@/lib/auth';
import { pendingCode } from '@/server/phone-otp';
import { TRIAL_MESSAGE } from '@/server/trial';
import { CodeForm, MobileForm, StartTrialForm } from './verify-forms';

export const metadata = { title: 'Start your free trial' };
export const dynamic = 'force-dynamic';

const pretty = (e164: string) => (e164.startsWith('+91') ? `+91 ${e164.slice(3, 8)} ${e164.slice(8)}` : e164);

export default async function VerifyMobilePage({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const { workspace: slug = '' } = await searchParams;
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/verify-mobile?workspace=${slug}`)}`);
  const tenant = (await tenantsForUser(session.user.id)).find((t) => t.slug === slug);
  if (!tenant) notFound();
  const sub = await withTenant(tenant.id, (tx) => tx.subscription.findUnique({ where: { tenantId: tenant.id } }));
  if (sub?.status !== 'pending') redirect(`/${slug}`);

  const [user, review, code] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { phoneNumber: true, phoneNumberVerified: true, trialUsedAt: true } }),
    prisma.trialReview.findFirst({ where: { tenantId: tenant.id, status: 'open' } }),
    pendingCode(session.user.id),
  ]);
  const phoneClaimed = user.phoneNumberVerified && user.phoneNumber ? Boolean(await prisma.trialClaim.findUnique({ where: { phone: user.phoneNumber } })) : false;
  const blocked = review ? TRIAL_MESSAGE.device : user.trialUsedAt ? TRIAL_MESSAGE.used : phoneClaimed ? TRIAL_MESSAGE.phone_used : null;

  return (
    <div className="card pop-in w-full max-w-md p-8">
      <Link href={`/${slug}`} className="mb-5 flex w-fit text-sm font-semibold text-muted hover:text-ink">← Back to {tenant.name}</Link>
      <span className="eyebrow">{TRIAL_DAYS}-day free trial · every feature</span>
      <h1 className="mt-2 text-[30px] leading-tight font-extrabold tracking-[-0.04em]">{blocked ? 'Choose a plan to start' : 'Verify your mobile'}</h1>

      {blocked ? (
        <>
          <p className="mt-2 text-sm text-muted">{blocked}</p>
          {review && <p className="mt-2 text-sm text-muted">Kicko has been told. If this is a new agency, we’ll start your trial shortly.</p>}
          <Link href={`/${slug}/settings?tab=plan`} className={buttonCls('primary', 'lg', 'mt-6 w-full')}>See plans</Link>
        </>
      ) : user.phoneNumberVerified && user.phoneNumber ? (
        <>
          <p className="mt-2 mb-6 text-sm text-muted">Your mobile {pretty(user.phoneNumber)} is verified. Start the trial for {tenant.name}.</p>
          <StartTrialForm slug={slug} />
        </>
      ) : code ? (
        <>
          <p className="mt-2 mb-6 text-sm text-muted">We sent a 6-digit code to <strong className="text-ink">{pretty(code.phone)}</strong>. It’s valid for 10 minutes.</p>
          {code.sandboxCode && (
            <p className="mb-4 rounded-[12px] bg-ink px-3 py-2 text-xs font-semibold text-lime">Sandbox: no SMS is sent. Your code is {code.sandboxCode}</p>
          )}
          <CodeForm slug={slug} phone={code.phone} />
        </>
      ) : (
        <>
          <p className="mt-2 mb-6 text-sm text-muted">We’ll send a code by SMS. Each mobile number gets one free trial.</p>
          <MobileForm slug={slug} />
        </>
      )}
    </div>
  );
}
