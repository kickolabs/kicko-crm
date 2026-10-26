import { Card, EmptyState, PageHeader } from '@/components/ui';
import { can } from '@/lib/permissions';
import { getCtx } from '@/lib/tenant';
import { InstitutionForm } from '../institution-form';
import { countryChoices } from '@/server/library';
import { scopeOf } from '@/server/scope';

export const metadata = { title: 'New institution' };

export default async function NewInstitution({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const ctx = await getCtx(slug);
  if (!can(ctx.role, 'partners.manage')) return <Card><EmptyState title="Admins only" /></Card>;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <PageHeader title="New institution" eyebrow="Partners" />
      <Card className="p-6"><InstitutionForm slug={slug} countries={await countryChoices(scopeOf(ctx)).then((c) => [...c.offered, ...c.others])} /></Card>
    </div>
  );
}
