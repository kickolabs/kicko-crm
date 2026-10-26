import clsx from 'clsx';
import Link from 'next/link';
import { portalIntake } from '@/server/intake';
import { requirePortal } from '@/server/portal-auth';
import { PortalShell } from '../portal-shell';
import { IntakeForm } from './intake-form';

export const metadata = { title: 'About you', robots: { index: false } };

export default async function PortalProfile({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { slug } = await params;
  const { lang } = await searchParams;
  const p = await requirePortal(slug);
  const q = await portalIntake(p, lang ?? 'en');
  return (
    <PortalShell slug={slug} agency={p.tenantName} active="journey">
      <section className="flex flex-col gap-3" dir={q?.language === 'ar' ? 'rtl' : undefined}>
        <Link href={`/portal/${slug}`} className="text-sm font-semibold text-muted hover:text-ink">← Back to your journey</Link>
        {q ? (
          <>
            <nav aria-label="Language" className="flex flex-wrap gap-1.5">
              {Object.entries(q.languages).map(([code, name]) => (
                <Link key={code} href={`?lang=${code}`} lang={code} aria-current={code === q.language ? 'true' : undefined} className={clsx('rounded-full px-3 py-1.5 text-sm font-semibold', code === q.language ? 'bg-ink text-paper' : 'bg-card text-ink-2 shadow-[var(--shadow-card)]')}>
                  {name}
                </Link>
              ))}
            </nav>
            <h1 lang={q.language} className="text-[34px] leading-tight font-extrabold tracking-[-0.04em]">{q.title}</h1>
            <p lang={q.language} className="max-w-2xl text-muted">{q.intro}</p>
          </>
        ) : (
          <h1 className="text-[34px] leading-tight font-extrabold tracking-[-0.04em]">Nothing to answer right now</h1>
        )}
      </section>
      {q ? (
        <IntakeForm slug={slug} lang={q.language} fields={q.questions.map((x) => x.field)} values={q.values} lookups={q.lookups} groupLabels={q.groupLabels} />
      ) : (
        <div className="card p-6 text-sm text-muted">Thank you! Your consultant will let you know if they need anything else.</div>
      )}
    </PortalShell>
  );
}
