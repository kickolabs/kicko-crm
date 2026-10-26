import { notFound } from 'next/navigation';
import { LogoMark } from '@/components/logo';
import { publicScope } from '@/server/public';
import { getTenantBySlug } from '@/lib/tenant';
import { EnquiryForm } from './enquiry-form';
import { countryChoices } from '@/server/library';

export const metadata = { title: 'Enquiry', robots: { index: false } };

export default async function EnquiryPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ k?: string; embed?: string }>;
}) {
  const { tenant: slug } = await params;
  const { k, embed } = await searchParams;
  const scope = await publicScope(slug, k);
  const tenant = await getTenantBySlug(slug);
  if (!scope || !tenant) notFound();

  return (
    <div className={embed ? 'p-3' : 'dotgrid flex min-h-dvh items-start justify-center px-4 py-10 sm:py-16'}>
      <div className="card w-full max-w-xl p-7 sm:p-8">
        <div className="mb-5 flex items-center gap-3">
          <LogoMark size={34} />
          <div>
            <div className="text-xs font-bold tracking-wide text-muted uppercase">{tenant.name}</div>
            <h1 className="text-[26px] leading-tight font-extrabold tracking-[-0.035em]">Tell us where you want to go.</h1>
          </div>
        </div>
        <p className="mb-6 text-sm text-muted">A counsellor will get back to you within one working day.</p>
        <EnquiryForm slug={slug} formKey={k!} countries={await countryChoices(scope)} />
      </div>
    </div>
  );
}
