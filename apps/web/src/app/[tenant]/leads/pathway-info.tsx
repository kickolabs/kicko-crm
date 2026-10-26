import clsx from 'clsx';
import { ExternalLink, TriangleAlert } from 'lucide-react';

// A workflow's reference info from the industry pack library: what the pathway is, who is
// eligible, the steps, published fees and processing times, and the official sources it
// was checked against. Shown as published, never as advice.

type Item = { key?: string; label?: string; name?: string; detail?: string };
type Fee = { label: string; amount?: number | string; currency?: string; note?: string };
type Source = { url: string; title?: string; publisher?: string; official?: boolean; verifiedAt?: string };
export type PathwayInfoData = {
  summary?: string;
  employerSponsorship?: string;
  skillLevel?: string;
  language?: string;
  licensing?: string;
  medical?: string;
  police?: string;
  processing?: string;
  portalUrl?: string;
  eligibility?: Item[];
  steps?: Item[];
  fees?: Fee[];
  sources?: Source[];
  unverified?: boolean;
};

const SPONSOR: Record<string, string> = { required: 'Employer sponsorship required', not_required: 'No employer sponsor needed', optional: 'Employer sponsor optional' };
const day = (d?: string) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : null);

export function PathwayInfo({ info: raw, className, open }: { info: unknown; className?: string; open?: boolean }) {
  const info = (raw ?? {}) as PathwayInfoData;
  if (!info.summary && !info.eligibility?.length && !info.sources?.length) return null;
  const verified = info.sources?.map((s) => s.verifiedAt).filter(Boolean).sort().at(-1);
  const facts = [
    info.employerSponsorship && SPONSOR[info.employerSponsorship],
    info.processing && `Processing: ${info.processing}`,
  ].filter(Boolean) as string[];
  return (
    <section className={clsx('rounded-[14px] bg-paper-2 p-4 text-sm', className)} aria-label="Pathway information">
      {info.summary && <p className="text-ink-2">{info.summary}</p>}
      {facts.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {facts.map((f) => <li key={f} className="rounded-full bg-card px-2.5 py-1 text-xs font-semibold text-ink-2">{f}</li>)}
        </ul>
      )}
      <details className="group mt-2" open={open}>
        <summary className="cursor-pointer text-xs font-bold text-ink select-none">Eligibility, steps &amp; fees</summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {!!info.eligibility?.length && (
            <div>
              <h4 className="eyebrow mb-1">Eligibility</h4>
              <ul className="list-disc space-y-0.5 pl-4 text-ink-2">
                {info.eligibility.map((e, i) => <li key={e.key ?? i}>{e.label ?? e.name}{e.detail ? <span className="text-muted">: {e.detail}</span> : null}</li>)}
              </ul>
            </div>
          )}
          {!!info.steps?.length && (
            <div>
              <h4 className="eyebrow mb-1">Steps</h4>
              <ol className="list-decimal space-y-0.5 pl-4 text-ink-2">
                {info.steps.map((s, i) => <li key={s.key ?? i}>{s.name ?? s.label}</li>)}
              </ol>
            </div>
          )}
          {[['Language', info.language], ['Licensing & recognition', info.licensing], ['Medical', info.medical], ['Police clearance', info.police]]
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <h4 className="eyebrow mb-1">{k}</h4>
                <p className="text-ink-2">{v}</p>
              </div>
            ))}
          {!!info.fees?.length && (
            <div>
              <h4 className="eyebrow mb-1">Government fees (as published)</h4>
              <ul className="space-y-0.5 text-ink-2">
                {info.fees.map((f, i) => (
                  <li key={i}>
                    {f.label}: <span className="font-semibold">{f.amount != null ? `${f.currency ?? ''} ${f.amount}`.trim() : '—'}</span>
                    {f.note ? <span className="text-muted"> · {f.note}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </details>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {info.unverified && (
          <span className="inline-flex items-center gap-1 font-semibold text-warn-ink"><TriangleAlert size={12} /> Some details not yet verified: check the official source</span>
        )}
        {info.portalUrl && (
          <a href={info.portalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-ink hover:underline">
            Official portal <ExternalLink size={11} />
          </a>
        )}
        {info.sources?.slice(0, 3).map((s) => (
          <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ink hover:underline">
            {s.publisher ?? s.title ?? new URL(s.url).hostname} <ExternalLink size={11} />
          </a>
        ))}
        {verified && <span>Checked {day(verified)}</span>}
      </div>
    </section>
  );
}
