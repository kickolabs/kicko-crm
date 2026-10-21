import { notFound } from 'next/navigation';
import { LogoMark } from '@/components/logo';
import { getTenantBySlug } from '@/lib/tenant';
import { ContinueButton } from './continue-button';

export const metadata = { title: 'Open your portal', robots: { index: false } };

// The login link lands here. Signing in needs a click (POST), so email link
// scanners that pre-open URLs can't burn the one-time token.
export default async function PortalAuth({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ t?: string }> }) {
  const { slug } = await params;
  const { t } = await searchParams;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();
  return (
    <div className="dotgrid flex min-h-dvh items-start justify-center px-4 pt-16 sm:pt-24">
      <div className="card pop-in flex w-full max-w-md flex-col gap-5 p-8">
        <div className="flex items-center gap-3">
          <LogoMark size={36} />
          <span className="font-bold">{tenant.name}</span>
        </div>
        <h1 className="text-[30px] leading-tight font-extrabold tracking-[-0.04em]">Welcome. Your visa journey is one tap away.</h1>
        {t ? <ContinueButton slug={slug} token={t} /> : <p className="text-sm text-danger">This link is incomplete. Ask your consultant for a new one.</p>}
        <p className="text-xs text-muted">You'll stay signed in on this device for 30 days.</p>
      </div>
    </div>
  );
}
