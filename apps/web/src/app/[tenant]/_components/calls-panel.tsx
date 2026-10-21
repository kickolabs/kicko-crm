import clsx from 'clsx';
import Link from 'next/link';
import { PhoneIncoming, PhoneMissed, PhoneOutgoing, Sparkles } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import type { Ctx } from '@/lib/tenant';
import type { Contact } from '@/server/contacts';
import { callsFor } from '@/server/calls/queries';
import { fmtDuration } from '@/server/calls/service';

const MISSED = ['NO_ANSWER', 'BUSY', 'FAILED', 'CANCELED'];

/** Recent calls with their AI summaries, for lead and client pages. */
export async function CallsPanel({ ctx, contact }: { ctx: Ctx; contact: Contact }) {
  const calls = await callsFor(ctx, contact);
  if (!calls.length) return null;
  const slug = ctx.tenant.slug;
  return (
    <Card>
      <CardHeader title="Calls" action={<Link href={`/${slug}/calls`} className="text-[13px] font-semibold text-muted hover:text-ink">All calls</Link>} />
      <ul className="divide-y divide-line">
        {calls.map((c) => {
          const missed = MISSED.includes(c.status);
          const Icon = missed ? PhoneMissed : c.direction === 'INBOUND' ? PhoneIncoming : PhoneOutgoing;
          return (
            <li key={c.id}>
              <Link href={`/${slug}/calls/${c.id}`} className="flex gap-3 px-5 py-3.5 hover:bg-paper-3">
                <Icon size={16} className={clsx('mt-0.5 shrink-0', missed ? 'text-danger' : 'text-ink-2')} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold">
                    {c.direction === 'INBOUND' ? 'Incoming' : 'Outgoing'} · {missed ? c.status.replace('_', ' ').toLowerCase() : c.status === 'COMPLETED' ? fmtDuration(c.durationSec) : 'in progress'}
                    <span className="font-normal text-muted"> · {fmtDateTime(c.startedAt, ctx.tenant.timezone)}</span>
                  </div>
                  {c.summary && (
                    <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-ink-2">
                      <Sparkles size={12} className="mr-1 inline text-ink-2" aria-label="AI" />
                      {c.summary}
                    </p>
                  )}
                  {c.aiStatus === 'pending' && <p className="mt-1 text-xs text-muted">Writing AI notes…</p>}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
