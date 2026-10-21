import { notFound, redirect } from 'next/navigation';
import { LogoMark } from '@/components/logo';
import { getTenantBySlug } from '@/lib/tenant';
import { getPartner } from '@/server/partner-auth';
import { PartnerLoginForm } from './login-form';

export const metadata = { title: 'Partner sign in', robots: { index: false } };

export default async function PartnerLogin({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();
  if (await getPartner(slug)) redirect(`/partner/${slug}`);
  return (
    <div className="dotgrid flex min-h-dvh items-start justify-center px-4 pt-16 sm:pt-24">
      <div className="card pop-in w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-3">
          <LogoMark size={36} />
          <div>
            <div className="text-xs font-bold tracking-wide text-muted uppercase">{tenant.name}</div>
            <div className="font-bold">Partner portal</div>
          </div>
        </div>
        <h1 className="text-[30px] leading-tight font-extrabold tracking-[-0.04em]">Refer clients. Track every one.</h1>
        <p className="mt-1 mb-6 text-sm text-muted">Enter the email the agency registered you with and we'll send a one-time sign-in link.</p>
        <PartnerLoginForm slug={slug} />
      </div>
    </div>
  );
}
