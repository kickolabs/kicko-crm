import Link from 'next/link';
import { portalQuestions } from '@/server/forms';
import { requirePortal } from '@/server/portal-auth';
import { PortalShell } from '../portal-shell';
import { QuestionsForm } from './questions-form';

export const metadata = { title: 'Questions from your consultant', robots: { index: false } };

export default async function PortalQuestions({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await requirePortal(slug);
  const q = await portalQuestions(p);
  return (
    <PortalShell slug={slug} agency={p.tenantName} active="journey">
      <section className="flex flex-col gap-2">
        <Link href={`/portal/${slug}`} className="text-sm font-semibold text-muted hover:text-ink">← Back to your journey</Link>
        <h1 className="text-[34px] leading-tight font-extrabold tracking-[-0.04em]">A few questions for your application</h1>
        <p className="max-w-2xl text-muted">
          {q.forms.length ? `Your consultant needs these for ${q.forms.join(', ')}.` : ''} Answer as they appear on your documents. You can save and come back later.
        </p>
      </section>
      {q.questions.length === 0 ? (
        <div className="card p-6 text-sm text-muted">Nothing to answer right now. Thank you!</div>
      ) : (
        <QuestionsForm slug={slug} questions={q.questions} />
      )}
    </PortalShell>
  );
}
