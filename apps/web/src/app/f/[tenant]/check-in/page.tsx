import { notFound } from 'next/navigation';
import { getTenantBySlug } from '@/lib/tenant';
import { publicScope } from '@/server/public';
import { KioskForm } from './kiosk-form';

export const metadata = { title: 'Check in', robots: { index: false } };

export default async function KioskPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ k?: string }>;
}) {
  const { tenant: slug } = await params;
  const { k } = await searchParams;
  const scope = await publicScope(slug, k);
  const tenant = await getTenantBySlug(slug);
  if (!scope || !tenant) notFound();
  return <KioskForm slug={slug} formKey={k!} agency={tenant.name} />;
}
