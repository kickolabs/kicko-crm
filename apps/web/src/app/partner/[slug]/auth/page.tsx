import { notFound } from 'next/navigation';
import { LogoMark } from '@/components/logo';
import { getTenantBySlug } from '@/lib/tenant';
import { PartnerContinue } from './continue-button';

export const metadata = { title: 'Open the partner portal', robots: { index: false } };

// Signing in needs a click (POST), so email link scanners can't burn the one-time token.
export default async function PartnerAuth({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ t?: string }> }) {
  const { slug } = await params;
  const { t } = await searchParams;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();
  return (
    <div className="dotgrid flex min-h-dvh items-start justify-center px-4 pt-16 sm:pt-24">
      <div className="card pop-in flex w-full max-w-md flex-col gap-5 p-8">
        <div className="flex items-center gap-3">
          <LogoMark size={36} />
          <span className="font-bold">{tenant.name} · Partners</span>
        </div>
        <h1 className="text-[30px] leading-tight font-extrabold tracking-[-0.04em]">Welcome, partner.</h1>
        {t ? <PartnerContinue slug={slug} token={t} /> : <p className="text-sm text-danger">This link is incomplete. Ask the agency for a new one.</p>}
        <p className="text-xs text-muted">You'll stay signed in on this device for 30 days.</p>
      </div>
    </div>
  );
}
