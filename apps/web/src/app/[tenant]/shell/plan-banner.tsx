import Link from 'next/link';
import type { Subscription } from '@kicko/db';
import { LogoMark } from '@/components/logo';
import { fmtDate } from '@/lib/format';

/** One line under the top bar: trial days left, payment due, or read-only. */
export function PlanBanner({ slug, sub, tz, canManage }: { slug: string; sub: Subscription | null; tz: string; canManage: boolean }) {
  if (!sub) return null;
  const href = `/${slug}/settings?tab=plan`;
  const cta = canManage ? <Link href={href} className="font-bold underline underline-offset-4">Choose a plan</Link> : <span>Ask an admin to renew.</span>;
  if (sub.status === 'trialing' && sub.trialEndsAt) {
    const days = Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - Date.now()) / 86400_000));
    return (
      <div role="status" className="flex flex-wrap items-center justify-center gap-2 bg-ink px-4 py-1.5 text-xs text-paper">
        Free trial: <strong>{days} day{days === 1 ? '' : 's'} left</strong> (until {fmtDate(sub.trialEndsAt, tz)}). Every feature is included.
        {canManage && <Link href={href} className="font-bold text-lime underline underline-offset-4">Choose a plan</Link>}
      </div>
    );
  }
  if (sub.status === 'past_due') {
    return <div role="alert" className="flex flex-wrap items-center justify-center gap-2 bg-warn-bg px-4 py-2 text-sm font-medium text-warn-ink">Your subscription payment failed. Renew within 7 days to keep editing. {cta}</div>;
  }
  if (sub.status === 'read_only' || sub.status === 'canceled') {
    return <div role="alert" className="flex flex-wrap items-center justify-center gap-2 bg-danger-bg px-4 py-2 text-sm font-medium text-danger">This workspace is read-only: you can view and export, but not make changes. {cta}</div>;
  }
  return null;
}

export function SuspendedScreen({ name, children }: { name: string; children?: React.ReactNode }) {
  return (
    <div className="dotgrid flex min-h-dvh items-start justify-center px-4 py-12">
      <div className="flex w-full max-w-5xl flex-col gap-6">
        <div className="card flex flex-col gap-3 p-8">
          <LogoMark size={36} />
          <h1 className="text-[32px] leading-tight font-extrabold tracking-[-0.04em]">{name} is suspended</h1>
          <p className="text-muted">The subscription ended more than 30 days ago. Your data is safe and kept for 90 days. Choose a plan to restore access straight away.</p>
        </div>
        {children ?? <p className="text-sm text-muted">Ask the workspace owner or an admin to renew.</p>}
      </div>
    </div>
  );
}
