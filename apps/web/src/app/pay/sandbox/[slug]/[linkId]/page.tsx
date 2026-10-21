import { notFound } from 'next/navigation';
import { withTenant } from '@kicko/db';
import { LogoMark } from '@/components/logo';
import { SubmitButton } from '@/components/forms';
import { formatMoney } from '@/lib/money';
import { getTenantBySlug } from '@/lib/tenant';
import { payInSandbox } from './actions';

export const metadata = { title: 'Test checkout', robots: { index: false } };

// Stand-in for a gateway's hosted checkout while an agency uses sandbox payments.
export default async function SandboxCheckout({ params }: { params: Promise<{ slug: string; linkId: string }> }) {
  const { slug, linkId } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();
  const link = await withTenant(tenant.id, (tx) => tx.paymentLink.findUnique({ where: { providerId: linkId }, include: { invoice: true } }));
  if (!link) notFound();
  const paid = link.status !== 'created';

  return (
    <div className="dotgrid flex min-h-dvh items-center justify-center px-4">
      <div className="card flex w-full max-w-md flex-col gap-5 p-8">
        <div className="flex items-center gap-3">
          <LogoMark size={36} />
          <div>
            <div className="text-xs font-bold tracking-wide text-muted uppercase">{tenant.name}</div>
            <div className="font-bold">Test checkout</div>
          </div>
          <span className="ml-auto rounded bg-ink px-1.5 py-0.5 text-[10px] font-bold text-lime">SANDBOX</span>
        </div>
        <div>
          <div className="text-sm text-muted">Invoice {link.invoice.ref}</div>
          <div className="text-[40px] leading-none font-extrabold tracking-[-0.04em] tabular-nums">{formatMoney(link.amount, link.invoice.currency)}</div>
        </div>
        {paid ? (
          <p className="rounded-[12px] bg-ok-bg px-3.5 py-2.5 text-[13px] font-medium text-ok">This link has already been paid.</p>
        ) : (
          <form action={payInSandbox.bind(null, slug, linkId)}>
            <SubmitButton variant="lime" size="lg" className="w-full">Simulate successful payment</SubmitButton>
          </form>
        )}
        <p className="text-xs leading-relaxed text-muted">No money moves here. This page acts like a real gateway: it sends a signed payment webhook to the agency's workspace, which records the payment and issues a receipt.</p>
      </div>
    </div>
  );
}
