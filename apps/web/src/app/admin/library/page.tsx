import clsx from 'clsx';
import Link from 'next/link';
import { getPack } from '@kicko/packs';
import { Badge, buttonCls, Card, CardHeader } from '@/components/ui';
import { libraryOverview, listLibrary, STALE_DAYS, type LibraryFilter } from '@/server/admin-library';
import { ImportForm, NewItemForm } from './library-forms';

export const metadata = { title: 'Library' };

const SHOW = [['all', 'All'], ['unverified', 'Not fully verified'], ['stale', `Not reviewed in ${STALE_DAYS} days`], ['archived', 'Archived']] as const;

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ pack?: string; type?: string; q?: string; show?: string; parent?: string }> }) {
  const sp = await searchParams;
  const overview = await libraryOverview();
  const pack = getPack(sp.pack ?? overview.packs[0]!.id);
  const show = (SHOW.find(([k]) => k === sp.show)?.[0] ?? 'all') as LibraryFilter['show'];
  const rows = await listLibrary({ pack: pack.id, type: sp.type, q: sp.q, show, parent: sp.parent });
  const stats = overview.packs.find((p) => p.id === pack.id)!;
  const qs = (patch: Record<string, string | undefined>) => `?${new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]).toString()}`;
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');
  const stale = (d: Date | null) => !d || Date.now() - d.getTime() > STALE_DAYS * 86_400_000;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/admin" className="text-xs font-semibold text-muted hover:text-ink">← Admin</Link>
          <h1 className="text-[28px] font-extrabold tracking-tight">Reference library · {pack.name}</h1>
          <p className="text-sm text-muted">Kicko-curated data every workspace reads. Edits create a new version; agencies apply it when they choose, and open cases never change.</p>
        </div>
        <a href={`/admin/library/export?pack=${pack.id}`} className={buttonCls('secondary')}>Export library.json</a>
      </div>

      <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.types.map((t) => (
          <Link key={t.type} href={qs({ type: t.type, show: undefined, parent: undefined })} className={clsx('card flex flex-col gap-1 p-4 hover:bg-paper-3', sp.type === t.type && 'ring-2 ring-ink')}>
            <span className="eyebrow">{t.label}</span>
            <span className="text-2xl font-extrabold tabular-nums">{t.total}</span>
            <span className="text-xs text-muted">{t.unverified} not fully verified · {t.stale} due for review</span>
          </Link>
        ))}
        <div className="card flex flex-col gap-1 p-4">
          <span className="eyebrow">Fully researched</span>
          <span className="text-2xl font-extrabold tabular-nums">{overview.fullCountries}</span>
          <span className="text-xs text-muted">countries with full pathways</span>
        </div>
      </section>

      <Card>
        <CardHeader title="Add an item" sub="New items start unverified with no data; fill in the JSON and sources, then mark verified." />
        <div className="p-5"><NewItemForm pack={pack.id} types={Object.entries(pack.libraryTypes).map(([k, v]) => [k, v.label])} /></div>
        <div className="border-t border-line p-5"><ImportForm pack={pack.id} /></div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
          {SHOW.map(([k, label]) => (
            <Link key={k} href={qs({ show: k === 'all' ? undefined : k })} className={clsx('rounded-full px-3 py-1.5 text-xs font-semibold', show === k ? 'bg-ink text-paper' : 'bg-paper-2 text-ink-2 hover:bg-paper-3')}>{label}</Link>
          ))}
          <form className="ml-auto flex gap-2">
            {Object.entries(sp).filter(([k]) => k !== 'q').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input name="q" defaultValue={sp.q ?? ''} placeholder="Search name or key" aria-label="Search the library" className="h-9 rounded-[10px] bg-card px-3 text-sm shadow-[inset_0_0_0_1px_var(--color-line-2)]" />
          </form>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-5 py-2 font-semibold">Type</th><th className="px-3 py-2 font-semibold">Key</th><th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Parent</th><th className="px-3 py-2 font-semibold">Coverage</th><th className="px-3 py-2 font-semibold">Reviewed</th><th className="px-3 py-2 font-semibold">v</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-paper-3">
                  <td className="px-5 py-2 text-xs text-muted">{pack.libraryTypes[r.type]?.label ?? r.type}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.key}</td>
                  <td className="px-3 py-2"><Link href={`/admin/library/${r.id}`} className="font-semibold hover:underline">{r.name}</Link>{r.unverified && <Badge tone="warn" className="ml-2">Partly verified</Badge>}</td>
                  <td className="px-3 py-2 text-xs">{r.parentKey ? <Link href={qs({ parent: r.parentKey })} className="hover:underline">{r.parentKey}</Link> : '—'}</td>
                  <td className="px-3 py-2 text-xs">{r.coverage ?? '—'}</td>
                  <td className={clsx('px-3 py-2 text-xs tabular-nums', stale(r.lastReviewedAt) && 'font-semibold text-warn-ink')}>{day(r.lastReviewedAt)}</td>
                  <td className="px-3 py-2 text-xs tabular-nums">{r.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 500 && <p className="px-5 py-3 text-xs text-muted">Showing the first 500. Narrow it down with the type cards or search.</p>}
        </div>
      </Card>
    </>
  );
}
