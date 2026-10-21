import clsx from 'clsx';
import Link from 'next/link';
import { ActionButton } from '@/components/forms';
import { Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { can } from '@/lib/permissions';
import { hasFeature } from '@/lib/plans';
import { DIMENSIONS, ENTITY_LABEL, MEASURES, measureValue, PERIODS, PRESETS, specFromParams, specToParams, type Measure, type ReportSpec } from '@/lib/reports';
import { getCtx } from '@/lib/tenant';
import { listSavedReports, runReport } from '@/server/reports';
import { scopeOf, UserError } from '@/server/scope';
import { deleteReportAction } from '../actions-phase7';
import { ReportControls, ReportTools } from './report-controls';

export const metadata = { title: 'Reports' };

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const ctx = await getCtx(slug);
  const scope = scopeOf(ctx);
  const billing = can(ctx.role, 'billing.read');
  const pro = hasFeature(ctx.subscription!, 'custom_fields');
  const presets = PRESETS.filter((p) => !p.billing || billing);
  const saved = await listSavedReports(scope);

  const savedHit = saved.find((s) => s.id === sp.r);
  const preset = presets.find((p) => p.id === sp.r) ?? (savedHit ? null : presets[0]!);
  const base: ReportSpec = savedHit ? (savedHit.spec as ReportSpec) : preset!.spec;
  // Without Pro only the period can change; grouping and measures stay as the ready-made report.
  const asked = specFromParams(sp, base);
  const spec: ReportSpec = pro ? asked : { ...base, period: asked.period, from: asked.from, to: asked.to };
  // Changing only the period keeps it the same report.
  const shape = (s: ReportSpec) => JSON.stringify(specToParams({ ...s, period: 'all', from: undefined, to: undefined }));
  const custom = pro && shape(spec) !== shape(base);
  const title = custom ? 'Custom report' : (savedHit?.name ?? preset!.name);

  let result: Awaited<ReturnType<typeof runReport>> | null = null;
  let error: string | null = null;
  try {
    result = await runReport(scope, spec, { billing });
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    error = e.message;
  }

  const currency = ctx.tenant.currency;
  const fmt = (m: Measure, v: number | null) => (v === null ? '—' : m === 'amount' ? formatMoney(v, currency) : m === 'count' ? v.toLocaleString('en-IN') : `${v}%`);
  const dimLabel = (k: string | null) => (k ? (DIMENSIONS[spec.entity].find((d) => d.key === k)?.label ?? result?.customDims.find((d) => d.key === k)?.label ?? k) : '');
  const measureLabel = MEASURES[spec.entity].find((m) => m.key === spec.measure)?.label ?? '';
  const t = result?.table;
  const max = t ? Math.max(1, ...t.rows.map((r) => measureValue(r.total, spec.measure) ?? 0)) : 1;
  const rate = spec.measure === 'conversion' || spec.measure === 'approval';
  const cols = t && spec.splitBy ? t.columns : [];

  // CSV, with labels.
  const head = [dimLabel(spec.groupBy), ...cols.map((c) => result!.columnLabels[c] ?? c), spec.splitBy ? 'Total' : measureLabel, ...(rate ? ['Out of'] : [])];
  const body = t
    ? [
        ...t.rows.map((r) => [result!.rowLabels[r.key] ?? r.key, ...cols.map((c) => measureValue(r.cells[c], spec.measure)), measureValue(r.total, spec.measure), ...(rate ? [spec.measure === 'conversion' ? r.total.n : r.total.decided] : [])]),
        ['Total', ...cols.map((c) => measureValue(t.totals[c], spec.measure)), measureValue(t.grand, spec.measure), ...(rate ? [spec.measure === 'conversion' ? t.grand.n : t.grand.decided] : [])],
      ]
    : [];
  const money = spec.measure === 'amount';
  const csvBody = money ? body.map((r) => r.map((v, i) => (i > 0 && typeof v === 'number' ? v / 100 : v))) : body;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <PageHeader title="Reports" sub="How leads, cases and collections are going. Download any report as CSV." />
      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <nav aria-label="Reports" className="flex flex-col gap-4">
          <div>
            <div className="eyebrow mb-2">Ready-made</div>
            <ul className="flex flex-col gap-0.5">
              {presets.map((p) => (
                <li key={p.id}>
                  <Link href={`?r=${p.id}`} aria-current={!custom && !savedHit && preset?.id === p.id ? 'page' : undefined} className={clsx('block rounded-[10px] px-3 py-2 text-sm', !custom && !savedHit && preset?.id === p.id ? 'bg-ink font-semibold text-paper' : 'hover:bg-paper-3')}>
                    {p.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          {saved.length > 0 && (
            <div>
              <div className="eyebrow mb-2">Saved</div>
              <ul className="flex flex-col gap-0.5">
                {saved.map((s) => (
                  <li key={s.id} className="flex items-center gap-1">
                    <Link href={`?r=${s.id}`} aria-current={!custom && savedHit?.id === s.id ? 'page' : undefined} className={clsx('flex-1 rounded-[10px] px-3 py-2 text-sm', !custom && savedHit?.id === s.id ? 'bg-ink font-semibold text-paper' : 'hover:bg-paper-3')}>
                      {s.name}
                    </Link>
                    {can(ctx.role, 'settings.manage') && (
                      <ActionButton action={deleteReportAction.bind(null, slug, s.id)} variant="ghost" title={`Delete ${s.name}`} confirm={`Delete the saved report “${s.name}”?`}>×</ActionButton>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </nav>

        <div className="flex min-w-0 flex-col gap-4">
          <ReportControls
            spec={spec}
            reportId={sp.r ?? null}
            pro={pro}
            billing={billing}
            customDims={result?.customDims ?? []}
          />
          <Card>
            <CardHeader
              title={title}
              sub={`${ENTITY_LABEL[spec.entity]} · ${measureLabel}${spec.splitBy ? ` by ${dimLabel(spec.groupBy).toLowerCase()} and ${dimLabel(spec.splitBy).toLowerCase()}` : ` by ${dimLabel(spec.groupBy).toLowerCase()}`} · ${PERIODS.find((p) => p.key === spec.period)?.label}${spec.filter?.status === 'OPEN' ? ' · open cases' : ''}`}
              action={t && <ReportTools slug={slug} spec={spec} pro={pro} csv={{ head, body: csvBody }} fileName={`${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`} />}
            />
            {error ? (
              <EmptyState title="This report can’t run" body={error} />
            ) : !t || t.grand.n === 0 ? (
              <EmptyState title="Nothing in this period" body="Try a longer period, like This year or All time." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-[11px] font-bold tracking-wide text-muted uppercase">
                    <tr className="border-b border-line">
                      <th scope="col" className="px-5 py-2.5">{dimLabel(spec.groupBy)}</th>
                      <th scope="col" className="w-[38%] px-3 py-2.5"><span className="sr-only">Chart</span></th>
                      {cols.map((c) => <th scope="col" key={c} className="px-3 py-2.5 text-right">{result!.columnLabels[c]}</th>)}
                      <th scope="col" className="px-5 py-2.5 text-right">{spec.splitBy ? 'Total' : measureLabel}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {t.rows.map((r) => {
                      const v = measureValue(r.total, spec.measure);
                      return (
                        <tr key={r.key}>
                          <td className="px-5 py-2.5 font-semibold whitespace-nowrap">{result!.rowLabels[r.key]}</td>
                          <td className="px-3 py-2.5">
                            <div className="h-2.5 overflow-hidden rounded-full bg-paper-2" aria-hidden="true">
                              <div className="h-full rounded-full bg-ink" style={{ width: `${rate ? (v ?? 0) : ((v ?? 0) / max) * 100}%` }} />
                            </div>
                          </td>
                          {cols.map((c) => {
                            const cv = measureValue(r.cells[c], spec.measure);
                            return <td key={c} className={clsx('px-3 py-2.5 text-right tabular-nums', !cv && 'text-faint')}>{fmt(spec.measure, cv)}</td>;
                          })}
                          <td className="px-5 py-2.5 text-right font-semibold tabular-nums">
                            {fmt(spec.measure, v)}
                            {rate && <span className="ml-1 text-xs font-normal text-muted">of {spec.measure === 'conversion' ? r.total.n : r.total.decided}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-ink/10 font-bold">
                      <td className="px-5 py-2.5">Total</td>
                      <td />
                      {cols.map((c) => <td key={c} className="px-3 py-2.5 text-right tabular-nums">{fmt(spec.measure, measureValue(t.totals[c], spec.measure))}</td>)}
                      <td className="px-5 py-2.5 text-right tabular-nums">
                        {fmt(spec.measure, measureValue(t.grand, spec.measure))}
                        {rate && <span className="ml-1 text-xs font-normal text-muted">of {spec.measure === 'conversion' ? t.grand.n : t.grand.decided}</span>}
                      </td>
                    </tr>
                  </tfoot>
                </table>
                {t.truncated && <p className="px-5 py-2 text-xs text-muted">Showing the 50 largest groups. The total includes everything.</p>}
                {result!.capped && <p className="px-5 py-2 text-xs text-warn-ink">Only the first 200,000 records in this period are counted. Choose a shorter period.</p>}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
