'use client';

import Link from 'next/link';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { Lock, Sparkles } from 'lucide-react';
import { AI_BRAND, AI_SHORT } from '@/lib/brand';
import { PLANS, planFor } from '@/lib/plans';
import type { Brief } from '@/server/ai/brief';

// Kicko Yu's daily brief on the dashboard. Growth and Pro (and trials) get it;
// on Starter, admins see what it would do and where to get it, staff see nothing.
// The brief loads with a plain request after the page renders: it can take a few
// seconds when the AI writes it, and a streamed server component would race any
// action clicked on the dashboard meanwhile.

function Shell({ children, label = 'Daily brief' }: { children: React.ReactNode; label?: string }) {
  return (
    <aside aria-label={AI_BRAND} className="card flex flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[8px] bg-lime">
          <Sparkles size={14} strokeWidth={2.2} aria-hidden="true" />
        </span>
        <h2 className="font-bold">{AI_SHORT}</h2>
        <span className="eyebrow ml-auto">{label}</span>
      </div>
      {children}
    </aside>
  );
}

/** "Three things need attention. One is fixable today." → ink, then faint. */
function Headline({ text }: { text: string }) {
  const cut = text.indexOf('. ');
  return (
    <p className="text-[21px] leading-[1.25] font-bold tracking-[-0.02em]">
      {cut < 0 ? text : <>{text.slice(0, cut + 1)} <span className="text-faint">{text.slice(cut + 2)}</span></>}
    </p>
  );
}

export function CopilotBrief({ slug }: { slug: string }) {
  const [brief, setBrief] = useState<Brief | null | 'loading'>('loading');
  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/t/${slug}/brief`, { signal: ctl.signal })
      .then((r) => (r.status === 200 ? (r.json() as Promise<Brief>) : null))
      .then(setBrief)
      .catch(() => {});
    return () => ctl.abort();
  }, [slug]);
  if (brief === 'loading') return <CopilotSkeleton />;
  if (!brief) return null;
  return (
    <Shell>
      <Headline text={brief.headline} />
      {brief.cards.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {brief.cards.map((c, i) => {
            const first = i === 0 && c.kind === 'risk';
            return (
              <li
                key={c.id}
                className={clsx('flex flex-col gap-2 rounded-[14px] p-3.5', first ? 'bg-[#FBF7EF] shadow-[inset_0_0_0_1px_rgb(180_83_9/0.18)]' : 'bg-paper-3')}
              >
                <span className={clsx('text-[11px] font-bold tracking-[0.06em] uppercase', c.kind === 'risk' ? 'text-warn-ink' : 'text-info')}>
                  {c.kind === 'risk' ? `Risk · ${c.tag}` : c.tag}
                </span>
                <span className="text-[13px] leading-normal text-ink-2">{c.line}</span>
                <Link
                  href={c.action.href}
                  className={clsx(
                    'self-start rounded-[9px] px-3 py-1.5 text-[13px]',
                    first ? 'bg-ink font-bold text-paper' : 'bg-card font-semibold shadow-[inset_0_0_0_1px_rgb(18_20_23/0.18)] hover:shadow-[inset_0_0_0_1px_var(--color-ink)]',
                  )}
                >
                  {c.action.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[11px] leading-[1.45] text-muted">
        {brief.note ? `${brief.note} ` : ''}
        {brief.mode === 'sandbox' && 'Sandbox: worded by rules until an AI model is connected. '}
        {AI_SHORT}&apos;s suggestions are advisory. A licensed consultant confirms every decision.
      </p>
    </Shell>
  );
}

export function CopilotSkeleton() {
  return (
    <Shell>
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Preparing the brief">
        <div className="h-5 w-4/5 animate-pulse rounded bg-paper-2" />
        <div className="h-5 w-3/5 animate-pulse rounded bg-paper-2" />
        <div className="mt-2 h-24 animate-pulse rounded-[14px] bg-paper-3" />
        <div className="h-20 animate-pulse rounded-[14px] bg-paper-3" />
      </div>
    </Shell>
  );
}

/** Starter, shown to people who can change the plan. */
export function CopilotUpsell({ slug }: { slug: string }) {
  const plan = PLANS[planFor('copilot')];
  return (
    <Shell label={`${plan.name} plan`}>
      <p className="text-[17px] leading-[1.3] font-bold tracking-[-0.02em]">
        {AI_BRAND} is part of {plan.name}. A brief every morning: documents that don&apos;t match, expiring passports, chats waiting on you, money overdue.
      </p>
      <Link href={`/${slug}/settings?tab=plan`} className="inline-flex items-center gap-2 self-start rounded-[10px] bg-ink px-3.5 py-2 text-[13px] font-bold text-paper">
        <Lock size={13} aria-hidden="true" /> See {plan.name}
      </Link>
    </Shell>
  );
}
