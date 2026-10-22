import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { AI_SHORT } from '@/lib/brand';
import type { ContactContext } from '@/server/thread-view';

/** Beside the conversation: who this is and where they stand, so staff reply without switching pages. */
export function ContextPanel({ c }: { c: NonNullable<ContactContext> }) {
  return (
    <aside aria-label="Contact context" className="hidden min-h-0 flex-col gap-5 overflow-y-auto border-l border-line px-5 py-5 xl:flex">
      {c.score !== null && (
        <section className="flex flex-col gap-2">
          <span className="eyebrow">Lead score</span>
          <div className="flex items-baseline gap-2">
            <span className="text-[30px] leading-none font-extrabold tracking-[-0.04em]">{c.score}</span>
            <span className="text-xs font-semibold text-muted">/ 100</span>
          </div>
          <div className="h-1.5 rounded-full bg-paper-2" aria-hidden="true">
            <div className="h-1.5 rounded-full bg-lime shadow-[inset_0_0_0_1px_rgb(18_20_23/0.25)]" style={{ width: `${c.score}%` }} />
          </div>
        </section>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
        <dt className="text-muted">Status</dt>
        <dd className="font-semibold">{c.status}</dd>
        {c.interest && (
          <>
            <dt className="text-muted">Interested in</dt>
            <dd className="font-semibold">{c.interest}</dd>
          </>
        )}
        {c.source && (
          <>
            <dt className="text-muted">Source</dt>
            <dd className="font-semibold">{c.source}</dd>
          </>
        )}
        <dt className="text-muted">Owner</dt>
        <dd className="font-semibold">{c.owner ?? 'Unassigned'}</dd>
        {c.nextAppointment && (
          <>
            <dt className="text-muted">Next</dt>
            <dd className="font-semibold">{c.nextAppointment}</dd>
          </>
        )}
        {c.amountDue && (
          <>
            <dt className="text-muted">Due</dt>
            <dd className="font-semibold text-warn-ink">{c.amountDue}</dd>
          </>
        )}
      </dl>

      {c.cases.length > 0 && (
        <section className="flex flex-col gap-2">
          <span className="eyebrow">Open cases</span>
          {c.cases.map((k) => (
            <Link key={k.id} href={k.href} className="flex flex-col rounded-[12px] bg-paper-3 px-3 py-2.5 hover:bg-paper-2">
              <span className="text-[13px] font-bold">{k.product}</span>
              <span className="text-xs text-muted">{k.ref} · {k.stage}</span>
            </Link>
          ))}
        </section>
      )}

      {c.eligibility && (
        <section className="flex flex-col gap-1">
          <span className="eyebrow">{c.eligibility.label}</span>
          <span className="text-[22px] leading-none font-extrabold tracking-[-0.03em]">{c.eligibility.score}</span>
          <span className="text-xs text-muted">Last calculated {c.eligibility.at}. An estimate, not a decision.</span>
        </section>
      )}

      {c.captured.length > 0 && (
        <section className="flex flex-col gap-2">
          <span className="eyebrow flex items-center gap-1.5"><Sparkles size={11} aria-hidden="true" /> Captured by {AI_SHORT}</span>
          {c.captured.map((n) => (
            <div key={n.id} className="rounded-[12px] bg-paper-3 px-3 py-2.5 text-[13px] leading-normal whitespace-pre-line text-ink-2">
              {n.text}
              <div className="mt-1 text-[11px] text-muted">{n.via} · {n.at}</div>
            </div>
          ))}
        </section>
      )}
    </aside>
  );
}
