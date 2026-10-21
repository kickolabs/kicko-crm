import Link from 'next/link';
import { Check, ChevronRight } from 'lucide-react';
import { ActionButton } from '@/components/forms';
import type { Ctx } from '@/lib/tenant';
import { onboarding } from '@/server/onboarding';
import { addSampleLeadsAction, dismissOnboardingAction, removeSampleLeadsAction } from '../actions-phase7';

/** "Get started" checklist for owners and admins of a new workspace. */
export async function GetStarted({ ctx }: { ctx: Ctx }) {
  const o = await onboarding(ctx);
  if (!o.show) return null;
  const slug = ctx.tenant.slug;
  return (
    <section aria-label="Get started" className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold">Get started</h2>
          <p className="text-xs text-muted">{o.done} of {o.total} done. Each step ticks itself off when it’s done.</p>
        </div>
        <div className="h-2 w-40 overflow-hidden rounded-full bg-paper-2" aria-hidden="true">
          <div className="h-full rounded-full bg-ink" style={{ width: `${(o.done / o.total) * 100}%` }} />
        </div>
        <ActionButton action={dismissOnboardingAction.bind(null, slug)} variant="ghost" confirm="Hide the Get started checklist?">Hide</ActionButton>
      </div>
      <div className="grid gap-0 lg:grid-cols-[1fr_300px]">
        <ol className="divide-y divide-line">
          {o.steps.map((s) => (
            <li key={s.key}>
              <Link href={s.href} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-paper-3">
                <span className={`grid size-5 shrink-0 place-items-center rounded-full ${s.done ? 'bg-ok text-paper' : 'shadow-[inset_0_0_0_1.5px_var(--color-line-2)]'}`}>
                  {s.done && <Check size={12} strokeWidth={3} />}
                  <span className="sr-only">{s.done ? 'Done:' : 'To do:'}</span>
                </span>
                <span className={s.done ? 'text-muted line-through decoration-ink/20' : 'font-semibold'}>{s.title}</span>
                {!s.done && <ChevronRight size={15} className="ml-auto text-faint" aria-hidden="true" />}
              </Link>
            </li>
          ))}
        </ol>
        <div className="flex flex-col gap-3 border-t border-line bg-paper-3 p-5 text-sm lg:border-t-0 lg:border-l">
          <h3 className="font-bold">Look around first?</h3>
          {o.sampleBatchId ? (
            <>
              <p className="text-muted">Sample leads are in your workspace. Try the board, the inbox and Reports, then remove them.</p>
              <ActionButton action={removeSampleLeadsAction.bind(null, slug)} confirm="Remove the sample leads?">Remove sample leads</ActionButton>
            </>
          ) : o.canAddSample ? (
            <>
              <p className="text-muted">Add 12 example leads to see the board, follow-ups and reports in action. Remove them with one click.</p>
              <ActionButton action={addSampleLeadsAction.bind(null, slug)} variant="primary">Try with sample leads</ActionButton>
            </>
          ) : (
            <p className="text-muted">You already have leads, so you’re past the sample stage. Ask us anything at support.</p>
          )}
        </div>
      </div>
    </section>
  );
}
