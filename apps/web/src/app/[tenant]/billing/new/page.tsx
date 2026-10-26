import { Card, EmptyState, PageHeader } from '@/components/ui';

import { fullName, toLocalInput } from '@/lib/format';
import { countryName } from '@/lib/countries';
import type { PlanStep } from '@/lib/money';
import { can } from '@/lib/permissions';
import { db, getCtx } from '@/lib/tenant';
import { listPackages } from '@/server/queries2';
import { InvoiceBuilder } from './invoice-builder';

export const metadata = { title: 'New invoice' };

export default async function NewInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ client?: string; case?: string }>;
}) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const ctx = await getCtx(slug);
  if (!can(ctx.role, 'billing.write')) return <Card><EmptyState title="Accounts only" body="Ask an owner, admin or accounts user to raise invoices." /></Card>;

  const [clients, packages] = await Promise.all([
    db(ctx, (tx) =>
      tx.client.findMany({
        orderBy: { createdAt: 'desc' },
        take: 500,
        include: { cases: { where: { status: { not: 'CLOSED' } }, include: { product: true } } },
      }),
    ),
    listPackages(ctx),
  ]);

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5">
      <PageHeader title="New invoice" eyebrow="Billing" />
      {clients.length === 0 ? (
        <Card><EmptyState title="No clients yet" body="Invoices are raised for clients. Convert a lead first." /></Card>
      ) : (
        <InvoiceBuilder
          slug={slug}
          clients={clients.map((c) => ({
            id: c.id,
            name: fullName(c),
            ref: c.ref,
            cases: c.cases.map((k) => ({ id: k.id, ref: k.ref, label: `${countryName(k.product.country)} · ${k.product.name}` })),
          }))}
          packages={packages.map((p) => ({ id: p.id, name: p.name, description: p.description, price: p.price, taxRate: p.taxRate, plan: p.plan as PlanStep[] }))}
          defaults={{
            clientId: sp.client,
            caseId: sp.case,
            taxMode: ctx.tenant.settings.billing?.defaultTaxMode ?? 'GST_INTRA',
            today: toLocalInput(new Date(), ctx.tenant.timezone, true),
          }}
        />
      )}
    </div>
  );
}
