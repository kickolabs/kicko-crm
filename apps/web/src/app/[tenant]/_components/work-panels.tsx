'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import type { Appointment, Task } from '@kicko/db';
import { ActionButton, ActionForm, FormField, Modal, SubmitButton } from '@/components/forms';
import { Button, Input, Select, Textarea } from '@/components/ui';
import {
  addNoteAction,
  createAppointmentAction,
  createTaskAction,
  deleteTaskAction,
  setAppointmentStatusAction,
  toggleTaskAction,
} from '../actions';

type Links = { leadId?: string; clientId?: string; caseId?: string };
type Member = { userId: string; name: string };

function LinkFields({ links }: { links: Links }) {
  return (
    <>
      {links.leadId && <input type="hidden" name="leadId" value={links.leadId} />}
      {links.clientId && <input type="hidden" name="clientId" value={links.clientId} />}
      {links.caseId && <input type="hidden" name="caseId" value={links.caseId} />}
    </>
  );
}

const fmt = (d: Date | string, tz: string, withTime = true) =>
  new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
    timeZone: tz,
  }).format(new Date(d));

export function TaskForm({
  slug,
  links,
  team,
  me,
  onDone,
}: {
  slug: string;
  links: Links;
  team: Member[];
  me: string;
  onDone?: () => void;
}) {
  return (
    <ActionForm action={createTaskAction.bind(null, slug)} onSuccess={onDone} resetOnSuccess className="flex flex-col gap-3">
      <LinkFields links={links} />
      <FormField label="Task" name="title">
        <Input name="title" placeholder="e.g. Collect 28-day bank statement" required autoFocus />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Due" name="dueAt">
          <Input name="dueAt" type="datetime-local" />
        </FormField>
        <FormField label="Assignee" name="assigneeId">
          <Select name="assigneeId" defaultValue={me}>
            {team.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Priority" name="priority">
          <Select name="priority" defaultValue="2">
            <option value="1">High</option>
            <option value="2">Normal</option>
            <option value="3">Low</option>
          </Select>
        </FormField>
      </div>
      <div className="flex justify-end">
        <SubmitButton>Add task</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function TaskRow({
  slug,
  task,
  tz,
  assignee,
  context,
}: {
  slug: string;
  task: Pick<Task, 'id' | 'title' | 'done' | 'dueAt' | 'priority'>;
  tz: string;
  assignee?: string;
  /** Plain data, not an element: elements built in a server component and rendered
   *  among a client component's children trigger React's missing-key warning. */
  context?: { href: string; label: string };
}) {
  const overdue = !task.done && task.dueAt && new Date(task.dueAt) < new Date();
  return (
    <li className="group flex items-start gap-3 py-2.5">
      <ActionButton
        action={() => toggleTaskAction(slug, task.id, !task.done)}
        variant="ghost"
        title={task.done ? 'Mark as not done' : 'Mark as done'}
        className={clsx(
          'mt-0.5 h-5 w-5 rounded-[6px] px-0 shadow-[inset_0_0_0_1.5px_var(--color-line-2)]',
          task.done && 'bg-ink text-lime shadow-none',
        )}
      >
        {task.done ? <Check size={12} strokeWidth={3} /> : null}
      </ActionButton>
      <div className="min-w-0 flex-1">
        <div className={clsx('text-sm font-semibold', task.done && 'text-faint line-through')}>
          {task.priority === 1 && !task.done && <span className="mr-1.5 rounded bg-warn-bg px-1 text-[10px] font-bold text-warn-ink">HIGH</span>}
          {task.title}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
          {task.dueAt && <span className={clsx(overdue && 'font-semibold text-danger')}>{overdue ? 'Overdue · ' : 'Due '}{fmt(task.dueAt, tz)}</span>}
          {assignee && <span>· {assignee}</span>}
          {context && <Link href={context.href} className="font-semibold text-ink-2 hover:underline">· {context.label}</Link>}
        </div>
      </div>
      <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <ActionButton action={() => deleteTaskAction(slug, task.id)} variant="ghost" title="Delete task" confirm="Delete this task?" className="w-8 px-0">
          <Trash2 size={14} />
        </ActionButton>
      </span>
    </li>
  );
}

export function TasksPanel({
  slug,
  tasks,
  tz,
  links,
  team,
  me,
}: {
  slug: string;
  tasks: Task[];
  tz: string;
  links: Links;
  team: Member[];
  me: string;
}) {
  const names = Object.fromEntries(team.map((m) => [m.userId, m.name]));
  return (
    <section className="card">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="text-base font-bold">Tasks</h2>
        <Modal
          title="New task"
          trigger={(open) => (
            <Button size="sm" onClick={open}>
              <Plus size={14} /> Task
            </Button>
          )}
        >
          {(close) => <TaskForm slug={slug} links={links} team={team} me={me} onDone={close} />}
        </Modal>
      </div>
      <ul className="divide-y divide-line px-5">
        {tasks.length === 0 && <li className="py-4 text-sm text-muted">No tasks yet.</li>}
        {tasks.map((t) => (
          <TaskRow key={t.id} slug={slug} task={t} tz={tz} assignee={t.assigneeId ? names[t.assigneeId] : undefined} />
        ))}
      </ul>
    </section>
  );
}

export function NoteBox({ slug, links }: { slug: string; links: Links }) {
  const [key, setKey] = useState(0);
  return (
    <ActionForm key={key} action={addNoteAction.bind(null, slug)} onSuccess={() => setKey((k) => k + 1)} className="flex flex-col gap-2">
      <LinkFields links={links} />
      <label htmlFor="body" className="sr-only">
        Add a note
      </label>
      <Textarea name="body" placeholder="Add a note: call summary, what the client said, next steps…" className="min-h-20" />
      <div className="flex justify-end">
        <SubmitButton size="sm">Add note</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function AppointmentForm({
  slug,
  links,
  team,
  me,
  defaultTitle,
  onDone,
}: {
  slug: string;
  links: Links;
  team: Member[];
  me: string;
  defaultTitle?: string;
  onDone?: () => void;
}) {
  return (
    <ActionForm action={createAppointmentAction.bind(null, slug)} onSuccess={onDone} className="flex flex-col gap-3">
      <LinkFields links={links} />
      <FormField label="Title" name="title">
        <Input name="title" defaultValue={defaultTitle ?? 'Consultation'} required />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Starts" name="startsAt">
          <Input name="startsAt" type="datetime-local" required />
        </FormField>
        <FormField label="Duration" name="durationMin">
          <Select name="durationMin" defaultValue="30">
            {[15, 30, 45, 60, 90].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Mode" name="mode">
          <Select name="mode" defaultValue="IN_PERSON">
            <option value="IN_PERSON">In person</option>
            <option value="VIDEO">Video call</option>
            <option value="PHONE">Phone</option>
          </Select>
        </FormField>
        <FormField label="With" name="staffId">
          <Select name="staffId" defaultValue={me}>
            {team.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <FormField label="Notes" name="notes">
        <Textarea name="notes" className="min-h-16" />
      </FormField>
      <div className="flex justify-end">
        <SubmitButton>Book appointment</SubmitButton>
      </div>
    </ActionForm>
  );
}

const APPT_STATUS = { SCHEDULED: 'Scheduled', COMPLETED: 'Completed', NO_SHOW: 'No-show', CANCELLED: 'Cancelled' } as const;

export function AppointmentsPanel({
  slug,
  items,
  tz,
  links,
  team,
  me,
}: {
  slug: string;
  items: Appointment[];
  tz: string;
  links: Links;
  team: Member[];
  me: string;
}) {
  const names = Object.fromEntries(team.map((m) => [m.userId, m.name]));
  return (
    <section className="card">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="text-base font-bold">Appointments</h2>
        <Modal
          title="Book appointment"
          trigger={(open) => (
            <Button size="sm" onClick={open}>
              <Plus size={14} /> Book
            </Button>
          )}
        >
          {(close) => <AppointmentForm slug={slug} links={links} team={team} me={me} onDone={close} />}
        </Modal>
      </div>
      <ul className="divide-y divide-line px-5">
        {items.length === 0 && <li className="py-4 text-sm text-muted">None booked.</li>}
        {items.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{a.title}</div>
              <div className="text-xs text-muted">
                {fmt(a.startsAt, tz)} · {a.mode === 'IN_PERSON' ? 'In person' : a.mode === 'VIDEO' ? 'Video' : 'Phone'}
                {a.staffId && names[a.staffId] ? ` · ${names[a.staffId]}` : ''}
              </div>
            </div>
            {a.status === 'SCHEDULED' ? (
              <div className="flex gap-1">
                <ActionButton action={() => setAppointmentStatusAction(slug, a.id, 'COMPLETED')} size="sm">
                  Done
                </ActionButton>
                <ActionButton action={() => setAppointmentStatusAction(slug, a.id, 'NO_SHOW')} size="sm" variant="ghost">
                  No-show
                </ActionButton>
              </div>
            ) : (
              <span className="text-xs font-semibold text-muted">{APPT_STATUS[a.status]}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
