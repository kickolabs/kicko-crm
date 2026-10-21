import Link from 'next/link';
import { Lock } from 'lucide-react';
import { FEATURE_LABEL, PLANS, planFor, type Feature } from '@/lib/plans';

/** Shown in place of a feature the workspace's plan doesn't include. */
export function UpgradeCard({ slug, feature, canManage }: { slug: string; feature: Feature; canManage: boolean }) {
  const plan = PLANS[planFor(feature)];
  return (
    <div className="card flex flex-col items-start gap-3 p-8">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ink text-lime"><Lock size={18} /></span>
      <h2 className="text-xl font-extrabold tracking-tight">{FEATURE_LABEL[feature]} is part of the {plan.name} plan</h2>
      <p className="max-w-lg text-sm text-muted">{plan.highlights.slice(1).join(' · ')}.</p>
      {canManage ? (
        <Link href={`/${slug}/settings?tab=plan`} className="rounded-[12px] bg-ink px-4 py-2.5 text-sm font-bold text-paper">See plans</Link>
      ) : (
        <p className="text-sm font-semibold">Ask a workspace admin to upgrade.</p>
      )}
    </div>
  );
}
