'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Badge, EmptyState, Input } from '@/components/ui';

export type Row = {
  id: string;
  name: string;
  slug: string;
  ownerEmail: string;
  joined: string;
  status: string | null;
  statusLabel: string;
  statusTone: 'ok' | 'info' | 'warn' | 'danger' | 'neutral';
  discountPct: number;
  plan: string;
  members: number;
  seats: number | null;
  leads: number;
  credits: number;
  mrr: number;
  mrrText: string;
  lastActive: string;
  trialEndingSoon: boolean;
};

const FILTERS = [
  ['all', 'All'],
  ['trialing', 'Trial'],
  ['ending', 'Trial ending'],
  ['paying', 'Paying'],
  ['risk', 'At risk'],
  ['suspended', 'Suspended'],
] as const;
type Filter = (typeof FILTERS)[number][0];

function matches(r: Row, f: Filter) {
  if (f === 'trialing') return r.status === 'trialing';
  if (f === 'ending') return r.trialEndingSoon;
  if (f === 'paying') return r.mrr > 0;
  if (f === 'risk') return r.status === 'past_due' || r.status === 'read_only';
  if (f === 'suspended') return r.status === 'suspended';
  return true;
}

const PAGE = 100;

export function AgencyTable({ rows, initialFilter, initialQuery }: { rows: Row[]; initialFilter: string; initialQuery: string }) {
  const [filter, setFilter] = useState<Filter>((FILTERS.find(([k]) => k === initialFilter)?.[0] ?? 'all') as Filter);
  const [query, setQuery] = useState(initialQuery);
  const [limit, setLimit] = useState(PAGE);
  const q = useDeferredValue(query.trim().toLowerCase());

  // Keep the address bar shareable without reloading the page.
  useEffect(() => {
    const p = new URLSearchParams();
    if (filter !== 'all') p.set('f', filter);
    if (q) p.set('q', q);
    window.history.replaceState(null, '', p.size ? `/admin?${p}` : '/admin');
    setLimit(PAGE);
  }, [filter, q]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([k]) => [k, rows.filter((r) => matches(r, k)).length])), [rows]);
  const shown = useMemo(
    () => rows.filter((r) => matches(r, filter) && (!q || r.name.toLowerCase().includes(q) || r.slug.includes(q) || r.ownerEmail.toLowerCase().includes(q))),
    [rows, filter, q],
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <div role="tablist" aria-label="Filter agencies" className="flex flex-wrap gap-1">
          {FILTERS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={filter === k}
              onClick={() => setFilter(k)}
              className={clsx('rounded-full px-3 py-1 text-xs font-bold', filter === k ? 'bg-ink text-paper' : 'text-muted hover:bg-paper-3')}
            >
              {label} <span className="tabular-nums opacity-60">{counts[k]}</span>
            </button>
          ))}
        </div>
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, address or owner email"
          aria-label="Search agencies"
          className="ml-auto h-9 w-72"
        />
      </div>
      {shown.length === 0 ? (
        <EmptyState title="No agencies match" body="Try another filter or search." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] font-bold tracking-wide text-muted uppercase">
              <tr className="border-b border-line">
                <th className="px-5 py-2.5">Agency</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Plan</th>
                <th className="px-3 py-2.5 text-right">Users</th>
                <th className="px-3 py-2.5 text-right">Leads</th>
                <th className="px-3 py-2.5 text-right">AI credits</th>
                <th className="px-3 py-2.5 text-right">MRR</th>
                <th className="px-5 py-2.5">Last active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.slice(0, limit).map((r) => (
                <tr key={r.id} className="hover:bg-paper-3">
                  <td className="px-5 py-3">
                    <Link href={`/admin/agencies/${r.id}`} className="font-bold hover:underline">{r.name}</Link>
                    <div className="text-xs text-muted">/{r.slug} · {r.ownerEmail || 'no owner'} · joined {r.joined}</div>
                  </td>
                  <td className="px-3 py-3">
                    {r.status ? <Badge tone={r.statusTone}>{r.statusLabel}</Badge> : '—'}
                    {r.discountPct > 0 && <Badge tone="lime" className="ml-1">{r.discountPct}% off</Badge>}
                  </td>
                  <td className="px-3 py-3 text-xs">{r.plan}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.members}{r.seats != null ? <span className="text-muted">/{r.seats}</span> : null}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.leads.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.credits.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums">{r.mrrText}</td>
                  <td className="px-5 py-3 text-xs text-muted">{r.lastActive}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > limit && (
            <div className="flex items-center justify-center gap-3 border-t border-line px-5 py-3 text-xs text-muted">
              Showing {limit} of {shown.length}
              <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="font-bold text-ink hover:underline">Show more</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
