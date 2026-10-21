'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOptimistic, useState, useTransition } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import type { LeadStatus } from '@kicko/db';
import { Avatar } from '@/components/ui';
import { LEAD_SOURCE_LABEL, LEAD_STATUS_LABEL } from '@/lib/constants';
import { setLeadStatusAction } from '../actions';

export type BoardLead = {
  id: string;
  ref: string;
  name: string;
  status: LeadStatus;
  source: keyof typeof LEAD_SOURCE_LABEL;
  product: string | null;
  owner: string | null;
  createdAt: string;
};

// WON happens through conversion and LOST needs a reason, so neither is a drop target.
const COLUMNS: LeadStatus[] = ['NEW', 'CONTACTED', 'QUALIFIED', 'CONSULT_BOOKED'];

export function LeadBoard({ slug, leads }: { slug: string; leads: BoardLead[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [items, move] = useOptimistic(leads, (state, { id, status }: { id: string; status: LeadStatus }) =>
    state.map((l) => (l.id === id ? { ...l, status } : l)),
  );
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  const onDragEnd = (e: DragEndEvent) => {
    const id = String(e.active.id);
    const to = e.over?.id as LeadStatus | undefined;
    const lead = items.find((l) => l.id === id);
    if (!to || !lead || lead.status === to) return;
    start(async () => {
      move({ id, status: to });
      const res = await setLeadStatusAction(slug, id, to);
      if (!res.ok) setError(res.error);
      else setError(null);
      router.refresh();
    });
  };

  // A fixed id keeps dnd-kit's generated aria ids identical on server and client (no hydration mismatch).
  return (
    <DndContext id="lead-board" sensors={sensors} onDragEnd={onDragEnd}>
      {error && (
        <div role="alert" className="mb-3 rounded-[12px] bg-danger-bg px-4 py-2.5 text-sm font-medium text-danger">
          {error}
        </div>
      )}
      <div className="grid gap-4 overflow-x-auto pb-2 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((status) => (
          <Column key={status} status={status} slug={slug} leads={items.filter((l) => l.status === status)} />
        ))}
      </div>
    </DndContext>
  );
}

function Column({ status, leads, slug }: { status: LeadStatus; leads: BoardLead[]; slug: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      aria-label={LEAD_STATUS_LABEL[status]}
      className={clsx(
        'flex min-h-48 min-w-[260px] flex-col gap-2.5 rounded-[18px] p-2.5 transition-colors',
        isOver ? 'bg-lime/30 shadow-[inset_0_0_0_2px_var(--color-ink)]' : 'bg-paper-2/80',
      )}
    >
      <header className="flex items-center justify-between px-2 pt-1">
        <h2 className="text-[13px] font-bold">{LEAD_STATUS_LABEL[status]}</h2>
        <span className={clsx('rounded-full px-2 text-xs font-bold', status === 'NEW' && leads.length ? 'bg-lime' : 'text-muted')}>
          {leads.length}
        </span>
      </header>
      {leads.map((l) => (
        <Card key={l.id} lead={l} slug={slug} />
      ))}
      {leads.length === 0 && <p className="px-2 py-6 text-center text-xs text-faint">Drop leads here</p>}
    </section>
  );
}

function Card({ lead, slug }: { lead: BoardLead; slug: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const days = Math.floor((Date.now() - new Date(lead.createdAt).getTime()) / 86400_000);
  return (
    <article
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0) rotate(1.5deg)` } : undefined}
      className={clsx(
        'cursor-grab touch-none rounded-[14px] bg-card p-3.5 shadow-[var(--shadow-card)] active:cursor-grabbing',
        isDragging && 'relative z-10 shadow-[var(--shadow-pop)]',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={`/${slug}/leads/${lead.id}`} className="font-bold hover:underline" onPointerDown={(e) => e.stopPropagation()}>
          {lead.name}
        </Link>
        <span className="shrink-0 text-[11px] font-semibold text-muted">{lead.ref}</span>
      </div>
      <div className="mt-1 truncate text-xs text-muted">{lead.product ?? 'No product yet'}</div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="rounded-full bg-paper px-2 py-0.5 text-[11px] font-semibold text-ink-2">{LEAD_SOURCE_LABEL[lead.source]}</span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          {days === 0 ? 'today' : `${days}d`}
          {lead.owner ? <Avatar name={lead.owner} size={20} /> : <span className="rounded-full bg-warn-bg px-1.5 font-bold text-warn-ink">unassigned</span>}
        </span>
      </div>
    </article>
  );
}
