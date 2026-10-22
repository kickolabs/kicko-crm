'use client';

import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { CaseOutcome, CaseStatus } from '@kicko/db';
import type { Stage } from '@kicko/db/visa-catalog';
import { ActionButton, ActionForm, FormBanner, FormField, Modal, SubmitButton } from '@/components/forms';
import { Button, Input, Select } from '@/components/ui';
import { moveStageAction, setCaseStatusAction, updateCaseDetailsAction } from '../../actions';

// ── Journey: the client's route as a flight path ─────────────────────────────

const W = 1200;
const H = 270;
const P0 = { x: 56, y: 186 };
const C = { x: 600, y: -26 };
const P2 = { x: 1144, y: 186 };
/** A point on the arc, t from 0 (first step) to 1 (last). */
const arc = (t: number) => ({
  x: (1 - t) ** 2 * P0.x + 2 * (1 - t) * t * C.x + t ** 2 * P2.x,
  y: (1 - t) ** 2 * P0.y + 2 * (1 - t) * t * C.y + t ** 2 * P2.y,
});
const along = (from: number, to: number) =>
  Array.from({ length: 41 }, (_, i) => arc(from + ((to - from) * i) / 40))
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
/** Lodged and Decision matter most to the client: bigger dots, bolder labels. */
const MILESTONE = /lodged|submitted|petition_filed|decision/;

type JourneyRoute = { from: string | null; to: string; km: number | null };

/**
 * The dark journey card: every stage on an arc from the client's city to the
 * destination; click one to move the case there. Phones get the same stages as a list.
 */
export function Journey({
  slug,
  caseId,
  stages,
  current,
  dates,
  ahead,
  route,
  editable,
}: {
  slug: string;
  caseId: string;
  stages: Stage[];
  current: string;
  /** Date each stage was reached ("12 Sep"). */
  dates: Record<string, string>;
  /** Dates still ahead: an appointment, or "est. 18 Nov" for the decision. */
  ahead: Record<string, string>;
  route: JourneyRoute;
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const idx = Math.max(0, stages.findIndex((s) => s.key === current));
  const next = stages[idx + 1];
  const n = stages.length;
  const t = (i: number) => (n > 1 ? i / (n - 1) : 0.5);
  const crowded = n > 8;

  const go = (key: string) =>
    start(async () => {
      const res = await moveStageAction(slug, caseId, key);
      setError(res.ok ? null : res.error);
      router.refresh();
    });
  const pick = (s: Stage) => {
    if (window.confirm(`Move this case to "${s.name}"?`)) go(s.key);
  };
  const state = (i: number) => (i < idx ? 'done' : i === idx ? 'now' : 'todo');
  // Reached stages show when they were reached; the current and later ones what's ahead.
  const sub = (s: Stage, i: number) => (i < idx ? dates[s.key] : (ahead[s.key] ?? (i === idx ? dates[s.key] : undefined)));
  const routeLine = route.from ? [route.from, route.km ? `${route.km.toLocaleString('en-IN')} km` : null, route.to].filter(Boolean).join(' · ') : `To ${route.to}`;

  const dot = (s: Stage, i: number, size: 'arc' | 'list') => {
    const st = state(i);
    const big = size === 'arc' && MILESTONE.test(s.key);
    return (
      <button
        type="button"
        disabled={!editable || pending || st === 'now'}
        onClick={() => pick(s)}
        aria-label={`${s.name}${st === 'now' ? ' (current stage)' : st === 'done' ? ' (done)' : ''}`}
        aria-current={st === 'now' ? 'step' : undefined}
        className={clsx(
          'relative z-10 flex shrink-0 items-center justify-center rounded-full transition-transform enabled:hover:scale-125 disabled:cursor-default',
          big ? 'h-7 w-7' : 'h-6 w-6',
          st === 'done' && 'bg-lime',
          // A border, not a ring: the pulse animation is a box-shadow and would hide a ring.
          st === 'now' && 'live-dot border-[3px] border-lime bg-ink',
          st === 'todo' && (MILESTONE.test(s.key) ? 'bg-ink ring-2 ring-white/60' : 'bg-ink ring-2 ring-white/35'),
        )}
      >
        {st === 'done' && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#121417" strokeWidth="3.5" strokeLinecap="round" aria-hidden="true">
            <path d="M5 12l5 5 9-10" />
          </svg>
        )}
      </button>
    );
  };
  const label = (s: Stage, i: number) => {
    const st = state(i);
    return clsx(MILESTONE.test(s.key) ? 'font-extrabold' : 'font-semibold', st === 'now' ? 'text-lime' : st === 'done' ? 'text-[#C4CAD2]' : 'text-[#A9AFB7]');
  };

  return (
    <section aria-label="Case journey" className="rounded-[24px] bg-ink px-6 pt-5 pb-5 text-paper">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-bold">Journey</h2>
          <span className="text-[11px] font-semibold tracking-[0.06em] text-[#A9AFB7] uppercase">{routeLine}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold tracking-wide text-[#A9AFB7] uppercase">
            Stage {idx + 1} of {n}
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
      <p className="sr-only">
        {route.from ? `${route.from} to ${route.to}` : `To ${route.to}`}: {idx} of {n} steps complete, now at {stages[idx]?.name}.
      </p>
      {error && <p role="alert" className="mt-3 rounded-[10px] bg-danger/20 px-3 py-2 text-sm text-[#FFB4AB]">{error}</p>}

      {/* Wider screens: the arc */}
      <div className="relative mt-2 hidden w-full sm:block" style={{ aspectRatio: `${W} / ${H}` }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden="true">
          <defs>
            <linearGradient id="journey-done" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#C8FF3D" stopOpacity="0.35" />
              <stop offset="1" stopColor="#C8FF3D" />
            </linearGradient>
          </defs>
          <path d="M0 60 H1200 M0 130 H1200 M0 200 H1200" stroke="rgb(255 255 255 / 0.05)" strokeWidth="1" />
          <polyline points={along(0, 1)} fill="none" stroke="rgb(255 255 255 / 0.18)" strokeWidth="2" strokeDasharray="4 8" />
          {idx > 0 && <polyline points={along(0, t(idx))} fill="none" stroke="url(#journey-done)" strokeWidth="3" strokeLinecap="round" />}
          {next && <polyline className="route-dash" points={along(t(idx), t(idx + 1))} fill="none" stroke="#C8FF3D" strokeOpacity="0.6" strokeWidth="2" strokeDasharray="6 6" />}
        </svg>
        <ol className="absolute inset-0">
          {stages.map((s, i) => {
            const p = arc(t(i));
            const above = crowded && i % 2 === 1;
            const note = sub(s, i);
            return (
              <li key={s.key} className="absolute" style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%` }}>
                <div className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2">{dot(s, i, 'arc')}</div>
                <div className={clsx('absolute left-0 flex w-[108px] -translate-x-1/2 items-center text-center leading-tight', above ? 'bottom-[18px] flex-col-reverse' : 'top-[18px] flex-col')}>
                  <span className={clsx('text-[12px]', label(s, i))}>
                    {s.name}
                    {i === idx && ' · now'}
                  </span>
                  {note && <span className={clsx('text-[11px]', i > idx ? 'text-[#A9AFB7]' : 'text-[#7D848C]')}>{note}</span>}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Phones: the same stages as a list */}
      <ol className="mt-4 flex flex-col sm:hidden">
        {stages.map((s, i) => {
          const note = sub(s, i);
          return (
            <li key={s.key} className="relative flex gap-3 pb-4 last:pb-0">
              {i < n - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute top-6 bottom-0 left-[11px] w-[2px]"
                  style={i < idx ? { background: 'var(--color-lime)', opacity: 0.6 } : { backgroundImage: 'repeating-linear-gradient(180deg, rgb(255 255 255 / 0.25) 0 4px, transparent 4px 9px)' }}
                />
              )}
              {dot(s, i, 'list')}
              <div className="flex min-w-0 flex-col pt-0.5">
                <span className={clsx('text-[13px]', label(s, i))}>
                  {s.name}
                  {i === idx && ' · now'}
                </span>
                {note && <span className="text-[11px] text-[#7D848C]">{note}</span>}
              </div>
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
