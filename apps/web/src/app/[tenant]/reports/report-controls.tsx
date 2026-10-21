'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Download, Lock } from 'lucide-react';
import { ActionForm, FormField, Modal, SubmitButton } from '@/components/forms';
import { Button, Input, Select } from '@/components/ui';
import { DIMENSIONS, ENTITY_LABEL, MEASURES, PERIODS, specToParams, tableCsv, type ReportEntity, type ReportSpec } from '@/lib/reports';
import { saveReportAction } from '../actions-phase7';

export function ReportControls({ spec, reportId, pro, billing, customDims }: { spec: ReportSpec; reportId: string | null; pro: boolean; billing: boolean; customDims: { key: string; label: string }[] }) {
  const router = useRouter();
  const path = usePathname();
  const go = (patch: Partial<ReportSpec>) => {
    const next = { ...spec, ...patch };
    const p = new URLSearchParams({ ...(reportId ? { r: reportId } : {}), ...specToParams(next) });
    router.push(`${path}?${p}`);
  };
  const dims = [...DIMENSIONS[spec.entity], ...(spec.entity === 'payments' ? [] : customDims)];
  const entities = (Object.keys(ENTITY_LABEL) as ReportEntity[]).filter((e) => e !== 'payments' || billing);
  const sel = 'h-9 w-auto min-w-36';

  return (
    <div className="card flex flex-wrap items-end gap-3 px-4 py-3">
      <Control label="Period">
        <Select aria-label="Period" className={sel} value={spec.period} onChange={(e) => go({ period: e.target.value as ReportSpec['period'] })}>
          {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </Select>
      </Control>
      {spec.period === 'custom' && (
        <>
          <Control label="From"><Input type="date" aria-label="From" className="h-9" defaultValue={spec.from} onBlur={(e) => e.target.value && go({ from: e.target.value })} /></Control>
          <Control label="To"><Input type="date" aria-label="To" className="h-9" defaultValue={spec.to} onBlur={(e) => e.target.value && go({ to: e.target.value })} /></Control>
        </>
      )}
      <span className="mx-1 hidden h-9 w-px bg-line sm:block" aria-hidden="true" />
      <fieldset disabled={!pro} className="contents">
        <Control label="Records">
          <Select aria-label="Records" className={sel} value={spec.entity} onChange={(e) => go({ entity: e.target.value as ReportEntity, groupBy: DIMENSIONS[e.target.value as ReportEntity][0]!.key, splitBy: null, measure: MEASURES[e.target.value as ReportEntity][0]!.key, filter: undefined, dateField: undefined })}>
            {entities.map((e) => <option key={e} value={e}>{ENTITY_LABEL[e]}</option>)}
          </Select>
        </Control>
        <Control label="Show">
          <Select aria-label="Measure" className={sel} value={spec.measure} onChange={(e) => go({ measure: e.target.value as ReportSpec['measure'] })}>
            {MEASURES[spec.entity].map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </Select>
        </Control>
        <Control label="Group by">
          <Select aria-label="Group by" className={sel} value={spec.groupBy} onChange={(e) => go({ groupBy: e.target.value, splitBy: spec.splitBy === e.target.value ? null : spec.splitBy })}>
            {dims.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </Select>
        </Control>
        <Control label="Split by">
          <Select aria-label="Split by" className={sel} value={spec.splitBy ?? ''} onChange={(e) => go({ splitBy: e.target.value || null })}>
            <option value="">Nothing</option>
            {dims.filter((d) => d.key !== spec.groupBy).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </Select>
        </Control>
        {spec.entity === 'cases' && (
          <Control label="Period applies to">
            <Select aria-label="Date" className={sel} value={spec.dateField ?? 'created'} onChange={(e) => go({ dateField: e.target.value as ReportSpec['dateField'] })}>
              <option value="created">Case opened</option>
              <option value="lodged">Lodged</option>
              <option value="decision">Decision</option>
            </Select>
          </Control>
        )}
      </fieldset>
      {!pro && (
        <span className="flex items-center gap-1.5 pb-2 text-xs text-muted">
          <Lock size={12} aria-hidden="true" /> Build your own reports with the Pro plan
        </span>
      )}
    </div>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 text-[11px] font-bold tracking-wide text-muted uppercase">
      {label}
      {children}
    </div>
  );
}

export function ReportTools({ slug, spec, pro, csv, fileName }: { slug: string; spec: ReportSpec; pro: boolean; csv: { head: string[]; body: (string | number | null)[][] }; fileName: string }) {
  const router = useRouter();
  const download = () => {
    const blob = new Blob([tableCsv(csv.head, csv.body)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={download}><Download size={14} aria-hidden="true" /> CSV</Button>
      {pro && (
        <Modal title="Save report" trigger={(open) => <Button size="sm" onClick={open}>Save</Button>}>
          {(close) => (
            <ActionForm
              action={saveReportAction.bind(null, slug, spec)}
              onSuccess={(r) => {
                close();
                if (r.ok && typeof r.data === 'string') router.push(`/${slug}/reports?r=${r.data}`);
              }}
              className="flex flex-col gap-4"
            >
              <FormField label="Name" name="name"><Input id="name" name="name" placeholder="e.g. Canada study leads by intake" /></FormField>
              <p className="text-xs text-muted">Everyone on the team can open saved reports.</p>
              <SubmitButton>Save report</SubmitButton>
            </ActionForm>
          )}
        </Modal>
      )}
    </div>
  );
}
