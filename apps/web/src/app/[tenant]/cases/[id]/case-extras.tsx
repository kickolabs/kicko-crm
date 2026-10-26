'use client';

import clsx from 'clsx';
import { CircleAlert, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { ActionButton, ActionForm, FormField, SubmitButton } from '@/components/forms';
import { Card, CardHeader, Input } from '@/components/ui';
import { setTrackAction, updateCaseExtrasAction } from '../../actions';

type Ref = { label: string; value: string };
const REF_SUGGESTIONS = ['Application number', 'Government reference', 'UCI / client ID', 'Biometrics appointment', 'VFS reference', 'Visa number'];

/**
 * What happens next on the case, and what's in the way: missing, rejected or expired
 * documents, overdue tasks, a stage over its expected time, a stage requirement not met.
 */
export function NextActionCard({
  slug,
  caseId,
  nextAction,
  refs,
  blockers,
  canEdit,
}: {
  slug: string;
  caseId: string;
  nextAction: string | null;
  refs: Ref[];
  blockers: { tone: 'danger' | 'warn'; text: string }[];
  canEdit: boolean;
}) {
  const [rows, setRows] = useState<Ref[]>(refs);
  return (
    <Card>
      <CardHeader title="Next action" sub={blockers.length ? `${blockers.length} thing${blockers.length > 1 ? 's' : ''} in the way` : 'Nothing blocking'} />
      {blockers.length > 0 && (
        <ul className="flex flex-col gap-1.5 px-5 pt-1">
          {blockers.map((b, i) => (
            <li key={i} className={clsx('flex items-start gap-2 text-sm', b.tone === 'danger' ? 'text-danger' : 'text-warn-ink')}>
              <CircleAlert size={15} className="mt-0.5 shrink-0" /> {b.text}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <ActionForm action={updateCaseExtrasAction.bind(null, slug, caseId)} className="flex flex-col gap-3 p-5">
          <FormField label="Next action" name="nextAction">
            <Input name="nextAction" defaultValue={nextAction ?? ''} placeholder="e.g. Chase employer for signed contract" />
          </FormField>
          <input type="hidden" name="refs" value={JSON.stringify(rows)} />
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold text-ink-2">Reference numbers</span>
            {rows.map((r, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={r.label}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  list="ref-labels"
                  placeholder="Label"
                  aria-label={`Reference ${i + 1} label`}
                  className="w-2/5"
                />
                <Input
                  value={r.value}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  placeholder="Number"
                  aria-label={`Reference ${i + 1} number`}
                />
                <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove reference ${i + 1}`} className="grid size-10 shrink-0 place-items-center rounded-[10px] text-muted hover:bg-paper-2">
                  <X size={15} />
                </button>
              </div>
            ))}
            <datalist id="ref-labels">{REF_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>
            <button type="button" onClick={() => setRows([...rows, { label: '', value: '' }])} className="inline-flex w-fit items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-sm font-semibold text-ink-2 hover:bg-paper-2">
              <Plus size={14} /> Add reference number
            </button>
          </div>
          <div className="flex justify-end"><SubmitButton size="sm">Save</SubmitButton></div>
        </ActionForm>
      ) : (
        <dl className="flex flex-col gap-2 p-5 text-sm">
          <div><dt className="text-xs text-muted">Next action</dt><dd className="font-semibold">{nextAction ?? '—'}</dd></div>
          {refs.map((r) => <div key={r.label}><dt className="text-xs text-muted">{r.label}</dt><dd className="font-semibold tabular-nums">{r.value}</dd></div>)}
        </dl>
      )}
    </Card>
  );
}

const TRACK_LABEL = { todo: 'To do', in_progress: 'In progress', done: 'Done', not_needed: 'Not needed' } as const;
type TrackStatus = keyof typeof TRACK_LABEL;

/** Side tracks run beside the main journey: each has its own status. */
export function TracksCard({ slug, caseId, tracks, canEdit }: { slug: string; caseId: string; tracks: { key: string; name: string; status: TrackStatus }[]; canEdit: boolean }) {
  if (!tracks.length) return null;
  return (
    <Card>
      <CardHeader title="Side tracks" sub="Running beside the main stages" />
      <ul className="divide-y divide-line px-5">
        {tracks.map((t) => (
          <li key={t.key} className="flex flex-wrap items-center gap-2 py-3">
            <span className="min-w-0 flex-1 text-sm font-semibold">{t.name}</span>
            {canEdit ? (
              <div className="flex gap-1" role="group" aria-label={`${t.name} status`}>
                {(Object.keys(TRACK_LABEL) as TrackStatus[]).map((s) => (
                  <ActionButton
                    key={s}
                    action={() => setTrackAction(slug, caseId, t.key, s)}
                    size="sm"
                    variant={t.status === s ? 'primary' : 'ghost'}
                  >
                    {TRACK_LABEL[s]}
                  </ActionButton>
                ))}
              </div>
            ) : (
              <span className="text-xs font-semibold text-muted">{TRACK_LABEL[t.status]}</span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
