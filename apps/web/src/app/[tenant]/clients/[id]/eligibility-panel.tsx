'use client';

import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { cloneElement, useId, useMemo, useState, useTransition } from 'react';
import { Sparkles } from 'lucide-react';
import { Badge, Button, Card, CardHeader, Input, Select } from '@/components/ui';
import { auPoints, auWhatIfs, type AuInput } from '@/lib/eligibility/au';
import { crs, crsWhatIfs, EDUCATION_LABEL, type CrsInput, type Education } from '@/lib/eligibility/crs';
import { celpipToClb, ieltsToAuEnglish, ieltsToClb, type Bands } from '@/lib/eligibility/language';
import { saveEligibilityAction } from '../../actions-phase5';

type Saved = {
  id: string;
  kind: 'CRS' | 'AU_POINTS';
  score: number;
  at: string;
  by: string | null;
  explanation: { summary: string; strengths: string[]; improvements: { change: string; points: number }[]; sandbox: boolean } | null;
};

const EDUCATIONS = Object.entries(EDUCATION_LABEL) as [Education, string][];

export function EligibilityPanel({
  slug,
  clientId,
  prefill,
  saved,
  canWrite,
}: {
  slug: string;
  clientId: string;
  prefill: { crs: CrsInput; au: AuInput; notes: string[] };
  saved: Saved[];
  canWrite: boolean;
}) {
  const [tab, setTab] = useState<'CRS' | 'AU_POINTS'>('CRS');
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="flex min-w-0 flex-col gap-5">
        <div role="tablist" aria-label="Calculator" className="flex gap-2">
          {(['CRS', 'AU_POINTS'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={clsx('rounded-full px-4 py-2 text-sm font-bold', tab === k ? 'bg-ink text-paper' : 'bg-card text-muted shadow-[var(--shadow-card)]')}>
              {k === 'CRS' ? 'Canada · Express Entry CRS' : 'Australia · Points test'}
            </button>
          ))}
        </div>
        {prefill.notes.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-[14px] bg-paper-3 px-4 py-3 text-xs text-ink-2">
            <li className="font-bold">Pre-filled from the profile. Check before saving:</li>
            {prefill.notes.map((n) => <li key={n}>· {n}</li>)}
          </ul>
        )}
        {tab === 'CRS' ? <CrsCalculator slug={slug} clientId={clientId} initial={prefill.crs} canWrite={canWrite} /> : <AuCalculator slug={slug} clientId={clientId} initial={prefill.au} canWrite={canWrite} />}
      </div>
      <History saved={saved} />
    </div>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────

/** Label linked by id (not wrapping), so a select's current value isn't read as part of its name. */
function Row({ label, children }: { label: string; children: React.ReactElement<{ id?: string }> }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-ink-2">{label}</label>
      {cloneElement(children, { id })}
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-ink" />
      {label}
    </label>
  );
}

function BandsInput({ label, value, onChange, step = 0.5 }: { label: string; value: Bands; onChange: (b: Bands) => void; step?: number }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-[13px] font-semibold text-ink-2">{label}</legend>
      <div className="grid grid-cols-4 gap-2">
        {(['l', 'r', 'w', 's'] as const).map((k) => (
          <label key={k} className="flex flex-col gap-1 text-[11px] font-bold text-muted uppercase">
            {{ l: 'Listening', r: 'Reading', w: 'Writing', s: 'Speaking' }[k]}
            <Input type="number" min={0} max={12} step={step} value={value[k]} onChange={(e) => onChange({ ...value, [k]: Number(e.target.value) })} aria-label={`${label} ${k}`} />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ScoreCard({ title, total, max, badge, sections, whatIfs, onSave, canWrite }: {
  title: string;
  total: number;
  max: number;
  badge?: React.ReactNode;
  sections: { title: string; points: number; max: number; lines: { label: string; points: number; max: number }[] }[];
  whatIfs: { change: string; points: number }[];
  onSave: () => Promise<string | null>;
  canWrite: boolean;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <section aria-label="Result" className="flex flex-col gap-4 rounded-[var(--radius-card)] bg-ink p-5 text-paper">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold tracking-wide text-paper/60 uppercase">{title}</div>
          <div className="text-[56px] leading-none font-extrabold tracking-[-0.05em] tabular-nums" data-testid="score">{total}</div>
          <div className="text-xs text-paper/60">of {max}</div>
        </div>
        {badge}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {sections.map((s) => (
          <div key={s.title} className="rounded-[14px] bg-paper/10 p-3">
            <div className="mb-1.5 flex justify-between text-xs font-bold"><span>{s.title}</span><span className="tabular-nums">{s.points}/{s.max}</span></div>
            <ul className="flex flex-col gap-1 text-xs text-paper/80">
              {s.lines.map((l) => (
                <li key={l.label} className="flex justify-between gap-3"><span>{l.label}</span><span className={clsx('tabular-nums', l.points > 0 && 'text-lime')}>{l.points}</span></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {whatIfs.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] font-bold tracking-wide text-paper/60 uppercase">Ways to add points</div>
          <ul className="flex flex-col gap-1.5 text-sm">
            {whatIfs.slice(0, 5).map((w) => (
              <li key={w.change} className="flex justify-between gap-3"><span>{w.change}</span><span className="font-bold text-lime tabular-nums">+{w.points}</span></li>
            ))}
          </ul>
        </div>
      )}
      {canWrite && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="lime"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const err = await onSave();
                setMsg(err ?? 'Saved with an explanation');
                if (!err) router.refresh();
              })
            }
          >
            <Sparkles size={15} /> {pending ? 'Saving…' : 'Save & explain'}
          </Button>
          {msg && <span role="status" className="text-xs text-paper/80">{msg}</span>}
        </div>
      )}
      <p className="text-[11px] text-paper/50">An estimate from the published points tables, not legal advice. Official assessments decide the final score.</p>
    </section>
  );
}

// ── Canada CRS ──────────────────────────────────────────────────────────────

function CrsCalculator({ slug, clientId, initial, canWrite }: { slug: string; clientId: string; initial: CrsInput; canWrite: boolean }) {
  const [i, setI] = useState<CrsInput>(initial);
  const [test, setTest] = useState<'CLB' | 'IELTS' | 'CELPIP'>('CLB');
  const [raw, setRaw] = useState<Bands>(initial.first);
  const [french, setFrench] = useState(Boolean(initial.second));
  const set = <K extends keyof CrsInput>(k: K, v: CrsInput[K]) => setI((p) => ({ ...p, [k]: v }));
  const setEnglish = (b: Bands, t = test) => {
    setRaw(b);
    set('first', t === 'IELTS' ? ieltsToClb(b) : t === 'CELPIP' ? celpipToClb(b) : b);
  };
  const r = useMemo(() => crs(i), [i]);
  const whatIfs = useMemo(() => crsWhatIfs(i), [i]);
  const clb = i.first;

  return (
    <>
      <Card>
        <CardHeader title="Applicant" />
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <Row label="Age"><Input type="number" min={16} max={80} value={i.age} onChange={(e) => set('age', Number(e.target.value))} /></Row>
          <Row label="Education">
            <Select value={i.education} onChange={(e) => set('education', e.target.value as Education)}>{EDUCATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
          </Row>
          <Row label="Spouse or partner coming">
            <Select value={i.spouse ? 'yes' : 'no'} onChange={(e) => set('spouse', e.target.value === 'yes')}><option value="no">No (or they're Canadian)</option><option value="yes">Yes</option></Select>
          </Row>
          <div className="sm:col-span-3">
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <Row label="English test">
                <Select value={test} onChange={(e) => { const t = e.target.value as typeof test; setTest(t); setEnglish(raw, t); }} className="w-56">
                  <option value="CLB">CLB levels (already converted)</option>
                  <option value="IELTS">IELTS General Training</option>
                  <option value="CELPIP">CELPIP-General</option>
                </Select>
              </Row>
              {test !== 'CLB' && <span className="mt-6 text-xs text-muted">= CLB {clb.l} / {clb.r} / {clb.w} / {clb.s}</span>}
            </div>
            <BandsInput label={test === 'IELTS' ? 'IELTS bands' : test === 'CELPIP' ? 'CELPIP levels' : 'CLB levels'} value={raw} onChange={(b) => setEnglish(b)} step={test === 'IELTS' ? 0.5 : 1} />
          </div>
          <div className="flex flex-col gap-3 sm:col-span-3">
            <Check label="Has a French test (TEF/TCF)" checked={french} onChange={(v) => { setFrench(v); set('second', v ? (i.second ?? { l: 7, r: 7, w: 7, s: 7 }) : null); }} />
            {french && i.second && <BandsInput label="French NCLC levels" value={i.second} onChange={(b) => set('second', b)} step={1} />}
          </div>
          <Row label="Skilled work in Canada (years)"><Input type="number" min={0} max={40} value={i.canadianWork} onChange={(e) => set('canadianWork', Number(e.target.value))} /></Row>
          <Row label="Skilled work outside Canada (years)"><Input type="number" min={0} max={40} value={i.foreignWork} onChange={(e) => set('foreignWork', Number(e.target.value))} /></Row>
          <Row label="Study in Canada">
            <Select value={i.canadianEducation} onChange={(e) => set('canadianEducation', e.target.value as CrsInput['canadianEducation'])}>
              <option value="none">None</option><option value="one_two">1–2 year credential</option><option value="three_plus">3+ year credential</option>
            </Select>
          </Row>
          <div className="flex flex-col gap-2 sm:col-span-3">
            <Check label="Provincial nomination" checked={i.provincialNomination} onChange={(v) => set('provincialNomination', v)} />
            <Check label="Brother or sister in Canada (citizen or PR)" checked={i.sibling} onChange={(v) => set('sibling', v)} />
            <Check label="Certificate of qualification in a trade" checked={i.certificate} onChange={(v) => set('certificate', v)} />
          </div>
        </div>
      </Card>
      {i.spouse && (
        <Card>
          <CardHeader title="Spouse or partner" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Row label="Spouse education">
              <Select value={i.spouseEducation} onChange={(e) => set('spouseEducation', e.target.value as Education)}>{EDUCATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            </Row>
            <Row label="Spouse skilled work in Canada (years)"><Input type="number" min={0} max={40} value={i.spouseCanadianWork} onChange={(e) => set('spouseCanadianWork', Number(e.target.value))} /></Row>
            <div className="sm:col-span-2">
              <BandsInput label="Spouse CLB levels (0 if no test)" value={i.spouseLanguage ?? { l: 0, r: 0, w: 0, s: 0 }} onChange={(b) => set('spouseLanguage', b)} step={1} />
            </div>
          </div>
        </Card>
      )}
      <ScoreCard
        title="Canada CRS"
        total={r.total}
        max={1200}
        sections={r.sections}
        whatIfs={whatIfs}
        canWrite={canWrite}
        onSave={async () => {
          const res = await saveEligibilityAction(slug, clientId, 'CRS', i);
          return res.ok ? null : res.error;
        }}
      />
    </>
  );
}

// ── Australia ───────────────────────────────────────────────────────────────

function AuCalculator({ slug, clientId, initial, canWrite }: { slug: string; clientId: string; initial: AuInput; canWrite: boolean }) {
  const [i, setI] = useState<AuInput>(initial);
  const [ielts, setIelts] = useState<Bands | null>(null);
  const set = <K extends keyof AuInput>(k: K, v: AuInput[K]) => setI((p) => ({ ...p, [k]: v }));
  const r = useMemo(() => auPoints(i), [i]);
  const whatIfs = useMemo(() => auWhatIfs(i), [i]);
  return (
    <>
      <Card>
        <CardHeader title="Applicant" />
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <Row label="Age"><Input type="number" min={16} max={80} value={i.age} onChange={(e) => set('age', Number(e.target.value))} /></Row>
          <Row label="English">
            <Select value={i.english} onChange={(e) => set('english', e.target.value as AuInput['english'])}>
              <option value="none">Below Competent</option>
              <option value="competent">Competent (IELTS 6 each)</option>
              <option value="proficient">Proficient (IELTS 7 each)</option>
              <option value="superior">Superior (IELTS 8 each)</option>
            </Select>
          </Row>
          <Row label="Highest qualification">
            <Select value={i.education} onChange={(e) => set('education', e.target.value as AuInput['education'])}>
              <option value="none">None recognised</option><option value="diploma">Diploma or trade qualification</option><option value="bachelor">Bachelor's or Master's</option><option value="doctorate">Doctorate</option>
            </Select>
          </Row>
          <div className="sm:col-span-3">
            {ielts ? (
              <BandsInput label="IELTS bands (sets the English level)" value={ielts} onChange={(b) => { setIelts(b); set('english', ieltsToAuEnglish(b)); }} />
            ) : (
              <button type="button" className="text-[13px] font-semibold text-ink underline underline-offset-4" onClick={() => setIelts({ l: 7, r: 7, w: 7, s: 7 })}>Work it out from IELTS bands</button>
            )}
            <p className="mt-1 text-xs text-muted">For PTE, TOEFL or OET, pick the level from the Home Affairs equivalence table.</p>
          </div>
          <Row label="Skilled work outside Australia (last 10 years)"><Input type="number" min={0} max={10} value={i.overseasWork} onChange={(e) => set('overseasWork', Number(e.target.value))} /></Row>
          <Row label="Skilled work in Australia (last 10 years)"><Input type="number" min={0} max={10} value={i.australianWork} onChange={(e) => set('australianWork', Number(e.target.value))} /></Row>
          <Row label="Partner">
            <Select value={i.partner} onChange={(e) => set('partner', e.target.value as AuInput['partner'])}>
              <option value="single">Single, or partner is an Australian citizen/PR</option>
              <option value="skilled">Partner skilled (assessment + Competent English, under 45)</option>
              <option value="english">Partner has Competent English only</option>
              <option value="none">Partner has neither</option>
            </Select>
          </Row>
          <Row label="Nomination">
            <Select value={i.nomination} onChange={(e) => set('nomination', e.target.value as AuInput['nomination'])}>
              <option value="none">None (subclass 189)</option><option value="190">State nomination (190)</option><option value="491">Regional nomination (491)</option>
            </Select>
          </Row>
          <div className="flex flex-col gap-2 sm:col-span-3">
            <Check label="Australian study requirement (2 years of study in Australia)" checked={i.australianStudy} onChange={(v) => set('australianStudy', v)} />
            <Check label="Studied in regional Australia" checked={i.regionalStudy} onChange={(v) => set('regionalStudy', v)} />
            <Check label="Specialist education (Australian STEM master's by research or PhD)" checked={i.specialistEducation} onChange={(v) => set('specialistEducation', v)} />
            <Check label="Professional Year completed" checked={i.professionalYear} onChange={(v) => set('professionalYear', v)} />
            <Check label="NAATI credentialled community language" checked={i.communityLanguage} onChange={(v) => set('communityLanguage', v)} />
          </div>
        </div>
      </Card>
      <ScoreCard
        title="Australia points"
        total={r.total}
        max={130}
        badge={r.blockers.length ? <Badge tone="danger">Not eligible yet</Badge> : r.passes ? <Badge tone="lime">Meets pass mark 65</Badge> : <Badge tone="warn">{65 - r.total} below pass mark</Badge>}
        sections={[{ title: 'Points', points: r.total, max: 130, lines: r.lines }]}
        whatIfs={whatIfs}
        canWrite={canWrite}
        onSave={async () => {
          const res = await saveEligibilityAction(slug, clientId, 'AU_POINTS', i);
          return res.ok ? null : res.error;
        }}
      />
      {r.blockers.length > 0 && <p role="alert" className="text-sm font-semibold text-danger">{r.blockers.join(' · ')}</p>}
    </>
  );
}

// ── History ─────────────────────────────────────────────────────────────────

function History({ saved }: { saved: Saved[] }) {
  return (
    <Card>
      <CardHeader title="Saved checks" sub="With an explanation you can share with the client" />
      <ul className="divide-y divide-line">
        {saved.length === 0 && <li className="px-5 py-5 text-sm text-muted">Nothing saved yet.</li>}
        {saved.map((s) => (
          <li key={s.id} className="flex flex-col gap-2 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-bold">{s.kind === 'CRS' ? 'Canada CRS' : 'Australia points'} · <span className="tabular-nums">{s.score}</span></span>
              <span className="text-xs text-muted">{s.at}{s.by ? ` · ${s.by}` : ''}</span>
            </div>
            {s.explanation && (
              <>
                <p className="text-[13px] leading-relaxed text-ink-2">{s.explanation.summary}</p>
                {s.explanation.improvements.length > 0 && (
                  <ul className="flex flex-col gap-1 text-xs">
                    {s.explanation.improvements.map((m) => (
                      <li key={m.change} className="flex justify-between gap-3"><span>{m.change}</span><span className="font-bold tabular-nums">+{m.points}</span></li>
                    ))}
                  </ul>
                )}
                {s.explanation.sandbox && <span className="text-[11px] text-muted">Explanation written by rules (sandbox).</span>}
              </>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
