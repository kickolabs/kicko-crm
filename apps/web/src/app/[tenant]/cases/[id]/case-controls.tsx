'use client';

import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { CaseOutcome, CaseStatus } from '@kicko/db';
import type { Stage } from '@kicko/db/visa-catalog';
import { ActionButton, ActionForm, FormBanner, FormField, Modal, SubmitButton } from '@/components/forms';
import { Button, Input, Select } from '@/components/ui';
import { moveStageAction, setCaseStatusAction, updateCaseDetailsAction } from '../../actions';

/** The dark journey card: every stage is a node; click one to move the case there. */
export function Journey({
  slug,
  caseId,
  stages,
  current,
  dates,
  editable,
}: {
  slug: string;
  caseId: string;
  stages: Stage[];
  current: string;
  dates: Record<string, string>;
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const idx = stages.findIndex((s) => s.key === current);
  const next = stages[idx + 1];

  const go = (key: string) =>
    start(async () => {
      const res = await moveStageAction(slug, caseId, key);
      setError(res.ok ? null : res.error);
      router.refresh();
    });

  return (
    <section aria-label="Case journey" className="rounded-[24px] bg-ink px-6 pt-5 pb-6 text-paper">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-bold">Journey</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold tracking-wide text-[#A9AFB7] uppercase">
            Stage {idx + 1} of {stages.length}
          </span>
          {editable && next && (
            <button
              type="button"
              disabled={pending}
              onClick={() => go(next.key)}
              className="h-9 rounded-[10px] bg-lime px-3.5 text-[13px] font-bold text-ink hover:brightness-95 disabled:opacity-60"
            >
              Advance to {next.name} →
            </button>
          )}
        </div>
      </div>
      {error && <p role="alert" className="mt-3 rounded-[10px] bg-danger/20 px-3 py-2 text-sm text-[#FFB4AB]">{error}</p>}
      <ol className="mt-6 flex overflow-x-auto pb-2">
        {stages.map((s, i) => {
          const done = i < idx;
          const now = i === idx;
          return (
            <li key={s.key} className="relative flex min-w-[112px] flex-1 flex-col items-center text-center">
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute top-[11px] right-1/2 left-[-50%] h-[3px]"
                  style={
                    i <= idx
                      ? { background: 'var(--color-lime)', opacity: 0.35 + (i / Math.max(1, idx)) * 0.65 }
                      : { backgroundImage: 'repeating-linear-gradient(90deg, rgb(255 255 255 / 0.25) 0 4px, transparent 4px 10px)' }
                  }
                />
              )}
              <button
                type="button"
                disabled={!editable || pending || now}
                onClick={() => {
                  if (window.confirm(`Move this case to "${s.name}"?`)) go(s.key);
                }}
                aria-label={`${s.name}${now ? ' (current stage)' : done ? ' (done)' : ''}`}
                aria-current={now ? 'step' : undefined}
                className={clsx(
                  'relative z-10 flex h-6 w-6 items-center justify-center rounded-full transition-transform enabled:hover:scale-125 disabled:cursor-default',
                  done && 'bg-lime',
                  now && 'live-dot bg-ink ring-[3px] ring-lime',
                  !done && !now && 'bg-ink ring-2 ring-white/35',
                )}
              >
                {done && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#121417" strokeWidth="3.5" strokeLinecap="round" aria-hidden="true">
                    <path d="M5 12l5 5 9-10" />
                  </svg>
                )}
              </button>
              <span className={clsx('mt-2.5 px-1 text-[12px] leading-tight font-semibold', now ? 'text-lime' : done ? 'text-[#C4CAD2]' : 'text-[#A9AFB7]')}>
                {s.name}
              </span>
              {dates[s.key] && <span className="mt-0.5 text-[11px] text-[#7D848C]">{dates[s.key]}</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const OUTCOMES: { v: CaseOutcome; label: string }[] = [
  { v: 'APPROVED', label: 'Approved / granted' },
  { v: 'REFUSED', label: 'Refused' },
  { v: 'WITHDRAWN', label: 'Withdrawn' },
];

export function StatusControls({ slug, caseId, status }: { slug: string; caseId: string; status: CaseStatus }) {
  const [outcome, setOutcome] = useState<CaseOutcome>('APPROVED');
  if (status === 'CLOSED' || status === 'ON_HOLD') {
    return (
      <ActionButton action={() => setCaseStatusAction(slug, caseId, 'OPEN')} size="md">
        Reopen case
      </ActionButton>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton action={() => setCaseStatusAction(slug, caseId, 'ON_HOLD')} size="md">
        Put on hold
      </ActionButton>
      <Modal title="Record decision & close" trigger={(open) => <Button variant="primary" onClick={open}>Record decision</Button>}>
        {(close) => (
          <div className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-[13px] font-semibold text-ink-2">Outcome</legend>
              {OUTCOMES.map((o) => (
                <label key={o.v} className={clsx('flex cursor-pointer items-center gap-3 rounded-[12px] px-3.5 py-3 text-sm font-semibold', outcome === o.v ? 'bg-ink text-paper' : 'shadow-[inset_0_0_0_1px_var(--color-line-2)]')}>
                  <input type="radio" name="outcome" value={o.v} checked={outcome === o.v} onChange={() => setOutcome(o.v)} className="sr-only" />
                  {o.label}
                </label>
              ))}
            </fieldset>
            <div className="flex justify-end">
              <ActionButton
                action={async () => {
                  const res = await setCaseStatusAction(slug, caseId, 'CLOSED', outcome);
                  if (res.ok) close();
                  return res;
                }}
                variant="primary"
                size="md"
              >
                Close case
              </ActionButton>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export function DetailsForm({
  slug,
  caseId,
  ownerId,
  team,
  dateFields,
  dates,
}: {
  slug: string;
  caseId: string;
  ownerId: string | null;
  team: { userId: string; name: string }[];
  dateFields: { key: string; label: string }[];
  dates: Record<string, string>;
}) {
  const [saved, setSaved] = useState(false);
  return (
    <ActionForm action={updateCaseDetailsAction.bind(null, slug, caseId, dateFields.map((f) => f.key))} onSuccess={() => setSaved(true)} className="flex flex-col gap-3.5">
      {saved && <FormBanner tone="ok">Saved.</FormBanner>}
      <FormField label="Case owner" name="ownerId">
        <Select name="ownerId" defaultValue={ownerId ?? ''}>
          <option value="">Unassigned</option>
          {team.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
        </Select>
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        {dateFields.map((f) => (
          <FormField key={f.key} label={f.label} name={`date_${f.key}`}>
            <Input name={`date_${f.key}`} type="date" defaultValue={dates[f.key] ?? ''} />
          </FormField>
        ))}
      </div>
      <div className="flex justify-end"><SubmitButton size="sm">Save details</SubmitButton></div>
    </ActionForm>
  );
}
