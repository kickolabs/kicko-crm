import { notFound, redirect } from 'next/navigation';
import { LogoMark } from '@/components/logo';
import { getTenantBySlug } from '@/lib/tenant';
import { connectionSummary } from '@/integrations/core/connections';
import { getPortal } from '@/server/portal-auth';
import { LoginForm } from './login-form';

export const metadata = { title: 'Client portal · Sign in', robots: { index: false } };

export default async function PortalLogin({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();
  if (await getPortal(slug)) redirect(`/portal/${slug}`);
  return (
    <div className="dotgrid flex min-h-dvh items-start justify-center px-4 pt-16 sm:pt-24">
      <div className="card pop-in w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-3">
          <LogoMark size={36} />
          <div>
            <div className="text-xs font-bold tracking-wide text-muted uppercase">{tenant.name}</div>
            <div className="font-bold">Client portal</div>
          </div>
        </div>
        <h1 className="text-[30px] leading-tight font-extrabold tracking-[-0.04em]">Sign in with a link.</h1>
        <p className="mt-1 mb-6 text-sm text-muted">No password needed. Enter the number or email you gave your consultant and we'll send you a one-time link.</p>
        <LoginForm slug={slug} whatsapp={Boolean(await connectionSummary(tenant.id, 'messaging'))} />
        <p className="mt-6 text-xs leading-relaxed text-muted">Your consultant can also send you a portal link on WhatsApp.</p>
      </div>
    </div>
  );
}
