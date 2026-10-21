import { LogoMark } from '@/components/logo';

export const metadata = { title: 'Payment received', robots: { index: false } };

// Gateways redirect the client here after paying a payment link.
export default async function Thanks({ searchParams }: { searchParams: Promise<{ razorpay_payment_link_status?: string }> }) {
  const { razorpay_payment_link_status: status } = await searchParams;
  const ok = status !== 'cancelled' && status !== 'failed';
  return (
    <div className="dotgrid flex min-h-dvh items-center justify-center px-6">
      <div className="card flex max-w-md flex-col items-center gap-4 p-10 text-center">
        <LogoMark size={44} />
        <h1 className="text-[30px] leading-tight font-extrabold tracking-[-0.04em]">{ok ? 'Payment received. Thank you.' : 'Payment not completed'}</h1>
        <p className="text-sm text-muted">
          {ok ? 'Your consultant will see it right away, and a receipt will be shared with you.' : 'No money was taken. You can try again from the same link.'}
        </p>
      </div>
    </div>
  );
}
