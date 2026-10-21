'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { ActionForm, SubmitButton } from '@/components/forms';
import { portalBookAction } from '../actions';

export function BookingForm({
  slug,
  days,
  tz,
  slotMinutes,
}: {
  slug: string;
  days: { date: string; label: string; slots: string[] }[];
  tz: string;
  slotMinutes: number;
}) {
  const [day, setDay] = useState(days[0]!.date);
  const [slot, setSlot] = useState<string | null>(null);
  const [mode, setMode] = useState<'IN_PERSON' | 'VIDEO' | 'PHONE'>('VIDEO');
  const current = days.find((d) => d.date === day)!;
  const time = (iso: string) => new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(iso));

  return (
    <ActionForm action={portalBookAction.bind(null, slug)} className="mt-6 flex flex-col gap-6">
      <input type="hidden" name="startsAt" value={slot ?? ''} />
      <input type="hidden" name="mode" value={mode} />
      <fieldset>
        <legend className="mb-2 text-sm font-bold">Day</legend>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {days.map((d) => (
            <button
              key={d.date}
              type="button"
              aria-pressed={d.date === day}
              onClick={() => { setDay(d.date); setSlot(null); }}
              className={clsx('shrink-0 rounded-[14px] px-4 py-3 text-sm font-semibold', d.date === day ? 'bg-ink text-paper' : 'bg-paper-3 hover:bg-paper-2')}
            >
              {d.label}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-bold">Time <span className="font-medium text-muted">({slotMinutes} min)</span></legend>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {current.slots.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={s === slot}
              onClick={() => setSlot(s)}
              className={clsx('rounded-[12px] py-2.5 text-sm font-semibold', s === slot ? 'bg-lime text-ink shadow-[inset_0_0_0_1.5px_var(--color-ink)]' : 'bg-card shadow-[inset_0_0_0_1px_var(--color-line-2)] hover:shadow-[inset_0_0_0_1px_var(--color-ink)]')}
            >
              {time(s)}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-bold">How would you like to meet?</legend>
        <div className="flex flex-wrap gap-2">
          {([['VIDEO', 'Video call'], ['PHONE', 'Phone call'], ['IN_PERSON', 'At the office']] as const).map(([v, l]) => (
            <button key={v} type="button" aria-pressed={mode === v} onClick={() => setMode(v)} className={clsx('rounded-full px-4 py-2 text-sm font-semibold', mode === v ? 'bg-ink text-paper' : 'bg-paper-3')}>
              {l}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-bold">What would you like to discuss? <span className="font-medium text-muted">(optional)</span></span>
        <textarea name="topic" rows={2} maxLength={300} className="rounded-[14px] bg-paper-3 px-4 py-3 outline-none focus:shadow-[inset_0_0_0_2px_var(--color-ink)]" />
      </label>
      <SubmitButton size="lg" className="w-full sm:w-auto">{slot ? `Book ${current.label}, ${time(slot)}` : 'Pick a time'}</SubmitButton>
    </ActionForm>
  );
}
