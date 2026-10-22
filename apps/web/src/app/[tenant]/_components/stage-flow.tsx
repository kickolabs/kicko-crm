import Link from 'next/link';
import { Card } from '@/components/ui';
import { CATEGORY_LABEL } from '@/lib/constants';
import type { VisaCategory } from '@kicko/db';
import { PHASES, type getStageFlow } from '@/server/stage-flow';
import { AutoSubmitSelect } from './auto-submit';

// The client journey, leads then cases, as horizontal bars (one hue: the length is
// the message), plus the visa-type split of cases in progress. Each phase links to
// the matching list.

// Fixed colour per visa type (validated categorical slots 1–5; labels always shown).
const CATEGORY_COLOR: Record<VisaCategory, string> = {
  STUDY: '#2a78d6',
  PR: '#eb6834',
  WORK: '#1baf7a',
  VISIT: '#eda100',
  FAMILY: '#e87ba4',
};

type Flow = Awaited<ReturnType<typeof getStageFlow>>;

export function StageFlow({ slug, flow, branches }: { slug: string; flow: Flow; branches: { id: string; name: string }[] }) {
  const q = (extra: Record<string, string | undefined>) =>
    `?${new URLSearchParams(Object.entries({ category: flow.category, branch: flow.branchId, ...extra }).filter(([, v]) => v) as [string, string][])}`;
  const href = (phase: (typeof PHASES)[number]['key']) =>
    phase === 'enquiry' || phase === 'qualified' ? `/${slug}/leads${q({})}` : `/${slug}/cases${q({ phase })}`;
  const max = Math.max(1, ...Object.values(flow.counts));
  const total = flow.split.reduce((s, c) => s + c.n, 0);
  const scope = [flow.category ? CATEGORY_LABEL[flow.category] : 'All visa types', flow.branchId ? (branches.find((b) => b.id === flow.branchId)?.name ?? 'Branch') : branches.length > 1 ? 'All branches' : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <Card className="flex flex-col" aria-label="Stage flow">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="font-bold">Stage flow</h2>
          <p className="text-xs text-muted">{scope} · in each phase now</p>
        </div>
        <form className="flex flex-wrap items-center gap-2" aria-label="Stage flow filters">
          <AutoSubmitSelect name="flowType" defaultValue={flow.category ?? ''} aria-label="Visa type" className="h-8 w-36 text-xs">
            <option value="">All visa types</option>
            {(Object.keys(CATEGORY_COLOR) as VisaCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </AutoSubmitSelect>
          {branches.length > 1 && (
            <AutoSubmitSelect name="flowBranch" defaultValue={flow.branchId ?? ''} aria-label="Branch" className="h-8 w-36 text-xs">
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </AutoSubmitSelect>
          )}
          <button type="submit" className="sr-only focus:not-sr-only focus:rounded-[8px] focus:px-2 focus:text-xs focus:font-semibold">Apply</button>
        </form>
      </div>

      <div className="grid grid-cols-[96px_1fr_auto] items-center gap-x-4 gap-y-2.5 px-5 py-5 text-[13px] sm:grid-cols-[120px_1fr_auto]">
        {PHASES.map((p, i) => {
          const n = flow.counts[p.key];
          const width = n ? Math.max(2, (n / max) * 100) : 0;
          return (
            <div key={p.key} className="contents">
              {i === 2 && <div className="col-span-3 mt-1 border-t border-line pt-2 text-[11px] font-bold tracking-wider text-muted uppercase">Cases</div>}
              {i === 0 && <div className="col-span-3 text-[11px] font-bold tracking-wider text-muted uppercase">Leads</div>}
              <Link href={href(p.key)} className="font-medium text-ink-2 hover:text-ink hover:underline">{p.label}</Link>
              <div className="flex h-3 gap-[2px] rounded-full bg-paper-2" aria-hidden="true">
                {p.key === 'decided' && n ? (
                  <>
                    <div className="h-3 rounded-l-full bg-ink" style={{ width: `${(flow.outcomes.approved / max) * 100}%` }} title={`${flow.outcomes.approved} approved`} />
                    {flow.outcomes.refused > 0 && <div className="h-3 rounded-r-full bg-faint" style={{ width: `${(flow.outcomes.refused / max) * 100}%` }} title={`${flow.outcomes.refused} refused`} />}
                  </>
                ) : (
                  width > 0 && <div className="h-3 rounded-full bg-ink/75" style={{ width: `${width}%` }} title={`${n} ${p.label.toLowerCase()}`} />
                )}
              </div>
              <span className="text-right font-bold tabular-nums">{n}</span>
              {p.key === 'decided' && n > 0 && (
                <span className="col-start-2 col-end-4 -mt-1.5 flex items-center gap-3 text-xs font-medium text-muted">
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px] bg-ink" aria-hidden="true" />{flow.outcomes.approved} approved</span>
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px] bg-faint" aria-hidden="true" />{flow.outcomes.refused} refused</span>
                </span>
              )}
            </div>
          );
        })}
      </div>

      {total > 0 && (
        <div className="flex flex-col gap-2.5 border-t border-line px-5 py-4">
          <span className="eyebrow">Cases in progress by visa type</span>
          <div className="flex h-3 gap-[2px]" role="img" aria-label={flow.split.map((s) => `${CATEGORY_LABEL[s.category]} ${Math.round((s.n / total) * 100)}% (${s.n})`).join(', ')}>
            {flow.split.map((s, i) => (
              <div
                key={s.category}
                title={`${CATEGORY_LABEL[s.category]}: ${s.n} (${Math.round((s.n / total) * 100)}%)`}
                className={i === 0 ? 'rounded-l-full' : i === flow.split.length - 1 ? 'rounded-r-full' : undefined}
                style={{ width: `${(s.n / total) * 100}%`, background: CATEGORY_COLOR[s.category], opacity: flow.category && flow.category !== s.category ? 0.3 : 1 }}
              />
            ))}
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {flow.split.map((s) => (
              <li key={s.category}>
                <Link href={`/${slug}/cases?${new URLSearchParams({ category: s.category, ...(flow.branchId ? { branch: flow.branchId } : {}) })}`} className="flex items-center gap-1.5 font-semibold text-ink-2 hover:text-ink">
                  <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: CATEGORY_COLOR[s.category] }} aria-hidden="true" />
                  {CATEGORY_LABEL[s.category]} {Math.round((s.n / total) * 100)}%
                  <span className="font-medium text-muted">({s.n})</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
