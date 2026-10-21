import clsx from 'clsx';
import type { Activity } from '@kicko/db';
import { fmtDateTime } from '@/lib/format';

const DOT: Record<string, string> = {
  LEAD_CREATED: 'bg-lime ring-ink',
  CONVERTED: 'bg-lime ring-ink',
  CASE_OPENED: 'bg-lime ring-ink',
  STAGE_CHANGED: 'bg-card ring-[#6FA82A]',
  STATUS_CHANGED: 'bg-card ring-[#6B9BEA]',
  NOTE: 'bg-card ring-[#B9BCC0]',
  DUPLICATE_ENQUIRY: 'bg-card ring-[#E8862A]',
  CHECK_IN: 'bg-card ring-[#0F6B63]',
  APPOINTMENT: 'bg-card ring-[#0F6B63]',
  TASK_DONE: 'bg-card ring-[#6FA82A]',
  CALL: 'bg-ink ring-ink',
};

const LABEL: Record<string, string> = {
  LEAD_CREATED: 'Lead',
  STATUS_CHANGED: 'Status',
  NOTE: 'Note',
  CONVERTED: 'Converted',
  CASE_OPENED: 'Case',
  STAGE_CHANGED: 'Stage',
  CASE_STATUS: 'Case',
  TASK_DONE: 'Task',
  APPOINTMENT: 'Appointment',
  DUPLICATE_ENQUIRY: 'Repeat enquiry',
  CHECK_IN: 'Walk-in',
  ASSIGNED: 'Owner',
  PROFILE_UPDATED: 'Profile',
  FAMILY_ADDED: 'Family',
  CALL: 'Call',
  ELIGIBILITY: 'Eligibility',
  SUB_AGENT: 'Sub-agent',
  FORMS: 'Forms',
  DOC_AI_CHECK: 'AI check',
};

export function Timeline({
  items,
  tz,
  people,
}: {
  items: Activity[];
  tz: string;
  people: Record<string, string>;
}) {
  if (!items.length) return <p className="text-sm text-muted">Nothing yet. Activity shows up here as you work.</p>;
  return (
    <ol className="ml-1.5 flex flex-col border-l-2 border-paper-2">
      {items.map((a) => {
        const msg = (a.data as { message?: string } | null)?.message;
        return (
          <li key={a.id} className="relative pb-4 pl-5 last:pb-0">
            <span className={clsx('absolute top-1 -left-[7px] h-3 w-3 rounded-full ring-[3px]', DOT[a.type] ?? 'bg-card ring-[#B9BCC0]')} />
            <div className="text-[11px] font-bold tracking-wide text-muted uppercase">
              {fmtDateTime(a.createdAt, tz)} · {LABEL[a.type] ?? a.type.toLowerCase()}
              {a.actorId && people[a.actorId] ? ` · ${people[a.actorId]}` : ''}
            </div>
            <p className="mt-0.5 text-[13px] leading-relaxed whitespace-pre-line text-ink-2">{a.summary}</p>
            {msg && <p className="mt-1 rounded-[10px] bg-paper-3 px-3 py-2 text-[13px] whitespace-pre-line text-ink-2">"{msg}"</p>}
          </li>
        );
      })}
    </ol>
  );
}
