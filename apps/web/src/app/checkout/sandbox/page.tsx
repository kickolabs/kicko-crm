import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LogoMark } from '@/components/logo';
import { SubmitButton } from '@/components/forms';
import { platformBilling } from '@/integrations/core/platform';
import { PLANS, type PlanId } from '@/lib/plans';
import { formatMoney } from '@/lib/money';
import { paySandbox } from './actions';

export const metadata = { title: 'Kicko checkout (sandbox)', robots: { index: false } };

// Stand-in for Razorpay's hosted checkout while Kicko's own billing runs in sandbox.
export default async function SandboxCheckout({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  if (!platformBilling().sandbox || !sp.tenant || !sp.slug || !sp.amount) notFound();
  const plan = sp.plan ? PLANS[sp.plan as PlanId] : null;
  const what = sp.topup
    ? `${Number(sp.credits).toLocaleString('en-IN')} AI credits`
    : `${plan?.name ?? ''} plan · ${sp.seats} user${sp.seats === '1' ? '' : 's'} · ${sp.interval === 'year' ? 'yearly' : 'monthly'}`;
  return (
    <div className="dotgrid flex min-h-dvh items-center justify-center px-4">
      <div className="card flex w-full max-w-md flex-col gap-5 p-8">
        <div className="flex items-center gap-3">
          <LogoMark size={36} />
          <div className="font-bold">Kicko checkout</div>
          <span className="ml-auto rounded bg-ink px-1.5 py-0.5 text-[10px] font-bold text-lime">SANDBOX</span>
        </div>
        <div>
          <div className="text-sm text-muted">{what}</div>
          <div className="text-[40px] leading-none font-extrabold tracking-[-0.04em] tabular-nums">{formatMoney(Number(sp.amount), sp.currency)}</div>
          <div className="text-xs text-muted">{sp.currency === 'INR' ? 'including 18% GST' : ''}{sp.topup ? '' : sp.interval === 'year' ? ' · billed yearly' : ' · billed monthly'}</div>
        </div>
        <form action={paySandbox.bind(null, sp)}>
          <SubmitButton variant="lime" size="lg" className="w-full">Simulate successful payment</SubmitButton>
        </form>
        {/^[a-z0-9-]+$/.test(sp.slug) && (
          <Link href={`/${sp.slug}/settings?tab=plan`} className="-mt-2 text-center text-sm font-semibold text-muted hover:text-ink">
            Cancel and go back
          </Link>
        )}
        <p className="text-xs leading-relaxed text-muted">No money moves. With Kicko's Razorpay account connected, this is Razorpay's checkout (UPI AutoPay, cards, e-mandate).</p>
      </div>
    </div>
  );
}
