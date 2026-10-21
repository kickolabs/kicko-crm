'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { Check, FileSpreadsheet, Upload } from 'lucide-react';
import { Badge, Button, buttonCls, Card, Select } from '@/components/ui';
import type { CfDef } from '@/lib/custom-fields';
import { cleanRow, dupKeys, fieldsFor, guessMapping, LIMITS, sampleCsv, type DateOrder, type Entity, type Mapping } from '@/lib/import/fields';
import { readSpreadsheet, SheetError, type Sheet } from '@/lib/import/read-file';
import { findExistingAction, finishImportAction, importChunkAction, startImportAction, undoImportAction } from '../actions-import';

type Member = { userId: string; name: string };
type Existing = Record<string, { kind: 'lead' | 'client'; ref: string; name: string }>;
type Step = 'upload' | 'map' | 'preview' | 'importing' | 'done';
type RowState = { row: number; status: 'new' | 'update' | 'skip' | 'link' | 'error'; note: string; name: string; contact: string };

const LABEL: Record<Entity, { one: string; many: string }> = { leads: { one: 'lead', many: 'leads' }, clients: { one: 'client', many: 'clients' } };
const STEPS: [Step, string][] = [['upload', 'Choose file'], ['map', 'Match columns'], ['preview', 'Check'], ['done', 'Import']];

export function ImportWizard({ slug, team, country, initialEntity, custom }: { slug: string; team: Member[]; country: string; initialEntity: Entity; custom: Record<Entity, CfDef[]> }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('upload');
  const [entity, setEntity] = useState<Entity>(initialEntity);
  const [file, setFile] = useState<{ name: string; sheet: Sheet } | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [dateOrder, setDateOrder] = useState<DateOrder>(country === 'US' ? 'MDY' : 'DMY');
  const [duplicates, setDuplicates] = useState<'skip' | 'update'>('skip');
  const [defaultOwner, setDefaultOwner] = useState('unassigned');
  const [existing, setExisting] = useState<Existing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ batchId: string; created: number; updated: number; skipped: number; failed: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const label = LABEL[entity];

  async function onFile(f: File | undefined) {
    if (!f) return;
    setError(null);
    setBusy(true);
    try {
      const sheet = await readSpreadsheet(f);
      setFile({ name: f.name, sheet });
      setMapping(guessMapping(entity, sheet.headers, custom[entity]));
      setStep('map');
    } catch (e) {
      setError(e instanceof SheetError ? e.message : 'This file couldn’t be read.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  const cleaned = useMemo(
    () => (file && step !== 'upload' ? file.sheet.rows.map((cells) => cleanRow(entity, cells, mapping, { country, dateOrder, custom: custom[entity] })) : []),
    [file, step, entity, mapping, country, dateOrder, custom],
  );

  // What will happen to each row (needs `existing` from the server).
  const rows = useMemo<RowState[]>(() => {
    if (!existing) return [];
    const seen = new Map<string, number>();
    return cleaned.map((r, i) => {
      const row = i + 2; // spreadsheet row number (header is row 1)
      if (!r.ok) return { row, status: 'error', note: r.error, name: '', contact: '' };
      const name = [r.data.firstName, r.data.lastName].filter(Boolean).join(' ');
      const contact = r.data.phone ?? r.data.email ?? '';
      const keys = dupKeys(r.data);
      const earlier = keys.map((k) => seen.get(k)).find((x) => x !== undefined);
      if (earlier) return { row, status: 'skip', note: `Same person as row ${earlier}`, name, contact };
      keys.forEach((k) => seen.set(k, row));
      const m = keys.map((k) => existing[k]).find(Boolean);
      const warn = r.warnings.join('; ');
      if (!m) return { row, status: 'new', note: warn, name, contact };
      if (entity === 'clients' && m.kind === 'lead') return { row, status: 'link', note: `Converts lead ${m.ref}`, name, contact };
      if (entity === 'leads' && m.kind === 'client') return { row, status: 'skip', note: `Already a client (${m.ref})`, name, contact };
      return duplicates === 'update'
        ? { row, status: 'update', note: `Updates ${m.ref} ${m.name}`, name, contact }
        : { row, status: 'skip', note: `Already exists (${m.ref} ${m.name})`, name, contact };
    });
  }, [cleaned, existing, duplicates, entity]);

  const count = (s: RowState['status']) => rows.filter((r) => r.status === s).length;
  const warnings = cleaned.filter((r) => r.ok && r.warnings.length).length;
  const toWrite = count('new') + count('link') + count('update');
  const hasName = (mapping.fullName ?? -1) >= 0 || (mapping.firstName ?? -1) >= 0 || (mapping.email ?? -1) >= 0;
  const hasContact = (mapping.phone ?? -1) >= 0 || (mapping.email ?? -1) >= 0;

  async function check() {
    setError(null);
    setBusy(true);
    try {
      const keys = [...new Set(cleaned.flatMap((r) => (r.ok ? dupKeys(r.data) : [])))];
      const found: Existing = {};
      for (let i = 0; i < keys.length; i += 4000) {
        const res = await findExistingAction(slug, keys.slice(i, i + 4000));
        if (!res.ok) throw new Error(res.error);
        Object.assign(found, res.data);
      }
      setExisting(found);
      setStep('preview');
    } catch (e) {
      setError((e as Error).message || 'Couldn’t check for duplicates. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!file) return;
    setError(null);
    setStep('importing');
    setProgress(0);
    // Send only the mapped columns, re-indexed, to keep each request small.
    const used = Object.entries(mapping).filter(([, i]) => i >= 0);
    const sent: Mapping = Object.fromEntries(used.map(([k], j) => [k, j]));
    const total = file.sheet.rows.length;
    const start = await startImportAction(slug, { entity, fileName: file.name, totalRows: total, duplicates, defaultOwner, dateOrder });
    if (!start.ok || !start.data) {
      setError(start.ok ? 'Couldn’t start the import' : start.error);
      setStep('preview');
      return;
    }
    const batchId = start.data;
    for (let i = 0; i < total; i += LIMITS.chunk) {
      const chunk = file.sheet.rows.slice(i, i + LIMITS.chunk).map((r) => used.map(([, c]) => r[c] ?? ''));
      const res = await importChunkAction(slug, batchId, { firstRow: i + 2, rows: chunk, mapping: sent });
      if (!res.ok) {
        setError(`Stopped at row ${i + 2}: ${res.error} Rows before it were imported; you can undo them below.`);
        break;
      }
      setProgress(Math.min(total, i + LIMITS.chunk));
    }
    const done = await finishImportAction(slug, batchId);
    if (done.ok && done.data) setResult({ batchId, ...done.data });
    setStep('done');
    router.refresh();
  }

  function reset() {
    setStep('upload');
    setFile(null);
    setExisting(null);
    setResult(null);
    setError(null);
  }

  const sampleHref = `data:text/csv;charset=utf-8,${encodeURIComponent(sampleCsv(entity))}`;

  return (
    <Card>
      <ol className="flex flex-wrap gap-x-6 gap-y-2 border-b border-line px-5 py-3 text-xs font-bold" aria-label="Steps">
        {STEPS.map(([s, name], i) => {
          const at = STEPS.findIndex(([x]) => x === (step === 'importing' ? 'done' : step));
          return (
            <li key={s} className={clsx('flex items-center gap-2', i === at ? 'text-ink' : i < at ? 'text-ok' : 'text-faint')} aria-current={i === at ? 'step' : undefined}>
              <span className={clsx('grid size-5 place-items-center rounded-full text-[10px]', i === at ? 'bg-ink text-paper' : i < at ? 'bg-ok-bg' : 'bg-paper-2')}>{i < at ? <Check size={12} /> : i + 1}</span>
              {name}
            </li>
          );
        })}
      </ol>

      {error && <p role="alert" className="mx-5 mt-4 rounded-[12px] bg-danger-bg px-3.5 py-2.5 text-sm font-semibold text-danger">{error}</p>}

      {step === 'upload' && (
        <div className="flex flex-col gap-5 p-5">
          <div role="tablist" aria-label="What to import" className="flex w-fit gap-1 rounded-full bg-paper-3 p-1">
            {(['leads', 'clients'] as const).map((e) => (
              <button key={e} type="button" role="tab" aria-selected={entity === e} onClick={() => setEntity(e)} className={clsx('rounded-full px-4 py-1.5 text-sm font-bold capitalize', entity === e ? 'bg-ink text-paper' : 'text-muted')}>
                {e}
              </button>
            ))}
          </div>
          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void onFile(e.dataTransfer.files[0]);
            }}
            className="flex cursor-pointer flex-col items-center gap-2 rounded-[18px] border-2 border-dashed border-line-2 px-6 py-12 text-center hover:border-ink"
          >
            <Upload size={22} aria-hidden="true" />
            <span className="font-bold">{busy ? 'Reading…' : `Drop a CSV or Excel file of ${label.many}, or click to choose`}</span>
            <span className="text-xs text-muted">.csv or .xlsx · up to {LIMITS.rows.toLocaleString('en-IN')} rows · read on your computer, nothing is uploaded until you import</span>
            <input ref={input} type="file" accept=".csv,.xlsx,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" aria-label="Spreadsheet file" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          <p className="text-xs text-muted">
            Coming from Excel, Zoho or another CRM? Export {label.many} as CSV or Excel. Column names don’t need to match: you’ll match them in the next step.{' '}
            <a href={sampleHref} download={`kicko-${entity}-sample.csv`} className="font-semibold text-ink underline">Download a sample file</a>
          </p>
        </div>
      )}

      {step === 'map' && file && (
        <div className="flex flex-col gap-5 p-5">
          <div className="flex items-center gap-2 text-sm">
            <FileSpreadsheet size={16} aria-hidden="true" />
            <strong>{file.name}</strong>
            <span className="text-muted">· {file.sheet.rows.length.toLocaleString('en-IN')} rows · {file.sheet.headers.length} columns</span>
            <button type="button" onClick={reset} className="ml-auto text-xs font-semibold text-muted hover:text-ink">Choose another file</button>
          </div>
          <div className="overflow-hidden rounded-[14px] shadow-[inset_0_0_0_1px_var(--color-line)]">
            <table className="w-full text-sm">
              <thead className="bg-paper-3 text-left text-[11px] font-bold tracking-wide text-muted uppercase">
                <tr><th className="px-4 py-2">Kicko field</th><th className="px-4 py-2">Column in your file</th><th className="px-4 py-2">First value</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {fieldsFor(entity, custom[entity]).map((f) => {
                  const col = mapping[f.key] ?? -1;
                  return (
                    <tr key={f.key}>
                      <td className="px-4 py-2">
                        <div className="font-semibold">{f.label}</div>
                        {f.hint && <div className="text-xs text-muted">{f.hint}</div>}
                      </td>
                      <td className="px-4 py-2">
                        <Select aria-label={`Column for ${f.label}`} value={col} onChange={(e) => setMapping({ ...mapping, [f.key]: Number(e.target.value) })} className="h-9 w-full max-w-64">
                          <option value={-1}>— Don’t import —</option>
                          {file.sheet.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                        </Select>
                      </td>
                      <td className="max-w-48 truncate px-4 py-2 text-xs text-muted">{col >= 0 ? file.sheet.rows.find((r) => r[col])?.[col] ?? '' : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
              Dates like 03/04/2026 mean
              <Select value={dateOrder} onChange={(e) => setDateOrder(e.target.value as DateOrder)} aria-label="Date format">
                <option value="DMY">3 April (day first)</option>
                <option value="MDY">March 4 (month first)</option>
              </Select>
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
              If a {label.one} already exists (same phone or email)
              <Select value={duplicates} onChange={(e) => setDuplicates(e.target.value as 'skip' | 'update')} aria-label="Existing records">
                <option value="skip">Skip it</option>
                <option value="update">Update it with the file’s values</option>
              </Select>
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
              Owner when the file doesn’t say
              <Select value={defaultOwner} onChange={(e) => setDefaultOwner(e.target.value)} aria-label="Default owner">
                <option value="unassigned">Unassigned</option>
                <option value="round_robin">Share between counsellors</option>
                {team.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
              </Select>
            </label>
          </div>
          {!hasName || !hasContact ? (
            <p className="text-sm font-semibold text-warn-ink">Match a name column and a phone or email column to continue.</p>
          ) : null}
          <div className="flex gap-2">
            <Button variant="primary" disabled={!hasName || !hasContact || busy} onClick={() => void check()}>{busy ? 'Checking…' : 'Check the file'}</Button>
          </div>
        </div>
      )}

      {step === 'preview' && file && (
        <div className="flex flex-col gap-5 p-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Summary">
            <Count n={count('new')} label={`new ${label.many}`} tone="ok" />
            {entity === 'clients' && <Count n={count('link')} label="from existing leads" tone="ok" />}
            <Count n={count('update')} label="will be updated" tone="info" />
            <Count n={count('skip')} label="skipped (duplicates)" />
            <Count n={count('error')} label="can’t be imported" tone={count('error') ? 'danger' : undefined} />
          </div>
          {warnings > 0 && <p className="text-xs text-muted">{warnings} row{warnings === 1 ? '' : 's'} have a value that will be left out (shown below). Everything else in those rows is imported.</p>}
          <div className="max-h-[420px] overflow-auto rounded-[14px] shadow-[inset_0_0_0_1px_var(--color-line)]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-paper-3 text-left text-[11px] font-bold tracking-wide text-muted uppercase">
                <tr><th className="px-4 py-2">Row</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Phone / email</th><th className="px-4 py-2">What happens</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...rows.filter((r) => r.status === 'error' || r.note), ...rows.filter((r) => r.status !== 'error' && !r.note)].slice(0, 200).map((r) => (
                  <tr key={r.row}>
                    <td className="px-4 py-2 text-xs text-muted tabular-nums">{r.row}</td>
                    <td className="px-4 py-2">{r.name || '—'}</td>
                    <td className="px-4 py-2 text-xs">{r.contact}</td>
                    <td className="px-4 py-2 text-xs">
                      <Badge tone={r.status === 'error' ? 'danger' : r.status === 'skip' ? 'neutral' : r.status === 'update' ? 'info' : 'ok'}>
                        {{ new: 'New', update: 'Update', skip: 'Skip', link: 'New client', error: 'Error' }[r.status]}
                      </Badge>{' '}
                      <span className="text-muted">{r.note}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 200 && <p className="text-xs text-muted">Showing rows with notes first, then the first of the rest (200 of {rows.length.toLocaleString('en-IN')}).</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={!toWrite} onClick={() => void runImport()}>
              Import {toWrite.toLocaleString('en-IN')} {toWrite === 1 ? label.one : label.many}
            </Button>
            <Button variant="ghost" onClick={() => setStep('map')}>Back to columns</Button>
          </div>
        </div>
      )}

      {step === 'importing' && file && (
        <div className="flex flex-col gap-3 p-5" role="status">
          <div className="text-sm font-semibold">Importing… {progress.toLocaleString('en-IN')} of {file.sheet.rows.length.toLocaleString('en-IN')} rows</div>
          <div className="h-2 overflow-hidden rounded-full bg-paper-2"><div className="h-full bg-ink transition-[width]" style={{ width: `${(progress / file.sheet.rows.length) * 100}%` }} /></div>
          <p className="text-xs text-muted">Keep this tab open until it finishes.</p>
        </div>
      )}

      {step === 'done' && (
        <div className="flex flex-col gap-4 p-5">
          {result && (
            <div role="status" className="flex flex-col gap-1">
              <div className="text-xl font-extrabold tracking-tight">Import finished</div>
              <div className="text-sm text-muted">
                {result.created.toLocaleString('en-IN')} created · {result.updated.toLocaleString('en-IN')} updated · {result.skipped.toLocaleString('en-IN')} skipped · {result.failed.toLocaleString('en-IN')} couldn’t be imported
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Link href={`/${slug}/${entity}${entity === 'leads' ? '?view=table' : ''}`} className={buttonCls('primary')}>View {label.many}</Link>
            <Button onClick={reset}>Import another file</Button>
            {result && result.created > 0 && (
              <Button
                variant="ghost"
                onClick={async () => {
                  if (!window.confirm(`Remove the ${result.created} ${label.many} this import created?`)) return;
                  const r = await undoImportAction(slug, result.batchId);
                  if (r.ok) {
                    reset();
                    router.refresh();
                  } else setError(r.error);
                }}
              >
                Undo this import
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function Count({ n, label, tone }: { n: number; label: string; tone?: 'ok' | 'info' | 'danger' }) {
  return (
    <div className="rounded-[14px] p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <div className={clsx('text-2xl font-extrabold tabular-nums', tone === 'ok' ? 'text-ok' : tone === 'info' ? 'text-info' : tone === 'danger' ? 'text-danger' : 'text-ink')}>{n.toLocaleString('en-IN')}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
