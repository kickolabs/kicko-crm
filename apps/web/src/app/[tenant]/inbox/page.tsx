import clsx from 'clsx';
import Link from 'next/link';
import { Card, EmptyState, LinkButton, PageHeader } from '@/components/ui';
import { relative } from '@/lib/format';
import { can } from '@/lib/permissions';
import { getCtx } from '@/lib/tenant';
import { connectionSummary } from '@/integrations/core/connections';
import { listThreads, parseContactKey } from '@/server/messages';
import { buildContactContext, buildThread } from '@/server/thread-view';
import { Conversation } from '../_components/conversation';
import { ContextPanel } from './context-panel';

export const metadata = { title: 'Inbox' };
export const dynamic = 'force-dynamic';

const FILTERS = [
  ['all', 'All'],
  ['unread', 'Unread'],
  ['whatsapp', 'WhatsApp'],
  ['mine', 'My contacts'],
] as const;

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ c?: string; f?: string }>;
}) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const filter = (FILTERS.find(([k]) => k === sp.f)?.[0] ?? 'all') as (typeof FILTERS)[number][0];
  const ctx = await getCtx(slug);
  const threads = await listThreads(ctx, filter);
  const activeKey = parseContactKey(sp.c) ? sp.c : threads[0]?.key;
  const contact = parseContactKey(activeKey);
  const [view, context] = contact ? await Promise.all([buildThread(ctx, contact), buildContactContext(ctx, contact)]) : [null, null];
  const wa = await connectionSummary(ctx.tenant.id, 'messaging');
  const totalUnread = threads.reduce((a, t) => a + t.unread, 0);
  const q = (f?: string, c?: string) => `?${new URLSearchParams(Object.entries({ f: f === 'all' ? undefined : f, c }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <PageHeader
        title="Inbox"
        sub={
          <>
            WhatsApp and portal messages in one place{totalUnread ? ` · ${totalUnread} unread` : ''}.
            {!wa && <> WhatsApp isn't connected yet.</>}
            {wa?.sandbox && <span className="ml-2 rounded bg-ink px-1.5 py-0.5 text-[10px] font-bold text-lime">WHATSAPP SANDBOX</span>}
          </>
        }
        actions={
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(([k, l]) => (
              <Link key={k} href={q(k)} className={clsx('rounded-full px-3.5 py-1.5 text-[13px] font-semibold', filter === k ? 'bg-ink text-paper' : 'bg-card text-muted shadow-[var(--shadow-card)] hover:text-ink')}>
                {l}
              </Link>
            ))}
            {!wa && can(ctx.role, 'settings.manage') && <LinkButton href={`/${slug}/settings?tab=whatsapp`} size="sm" variant="primary">Connect WhatsApp</LinkButton>}
          </div>
        }
      />
      {threads.length === 0 ? (
        <Card>
          <EmptyState
            title="No conversations yet"
            body={wa ? 'New WhatsApp messages and portal messages land here. New numbers become leads automatically.' : 'Connect WhatsApp, or invite a client to their portal. Their messages land here.'}
          />
        </Card>
      ) : (
        <Card className="grid h-[74vh] grid-cols-1 overflow-hidden md:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_280px]">
          <nav aria-label="Conversations" className="overflow-y-auto border-b border-line md:border-r md:border-b-0">
            {threads.map((t) => {
              const on = t.key === activeKey;
              return (
                <Link
                  key={t.key}
                  href={q(filter, t.key)}
                  aria-current={on ? 'true' : undefined}
                  className={clsx('flex flex-col gap-1 border-b border-line px-4 py-3.5', on ? 'bg-paper-3 shadow-[inset_3px_0_0_var(--color-ink)]' : 'hover:bg-paper-3')}
                >
                  <div className="flex items-center gap-2">
                    <span className={clsx('rounded-[5px] px-1.5 text-[10px] font-extrabold', t.last.channel === 'WHATSAPP' ? 'bg-[#DCF5D6] text-[#1F6B14]' : 'bg-info-bg text-info')}>
                      {t.last.channel === 'WHATSAPP' ? 'WA' : 'PORTAL'}
                    </span>
                    <span className={clsx('min-w-0 flex-1 truncate', t.unread ? 'font-extrabold' : 'font-semibold')}>{t.name}</span>
                    <span className="text-[11px] text-muted">{relative(t.last.at)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{t.last.direction === 'OUTBOUND' ? 'You: ' : ''}{t.last.body}</span>
                    {t.contact.kind === 'lead' && <span className="rounded-full bg-lime px-1.5 text-[10px] font-bold">LEAD</span>}
                    {t.unread > 0 && <span className="rounded-full bg-ink px-1.5 text-[11px] font-bold text-lime">{t.unread}</span>}
                  </div>
                </Link>
              );
            })}
          </nav>
          {view && (
            <section aria-label={`Conversation with ${view.name}`} className="flex min-h-0 flex-col">
              <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
                <div>
                  <Link href={view.href} className="font-bold hover:underline">{view.name}</Link>
                  <div className="text-xs text-muted">{view.kind === 'lead' ? 'Lead' : 'Client'} {view.ref}{view.phone ? ` · ${view.phone}` : ''}</div>
                </div>
                <Link href={view.href} className="text-[13px] font-semibold text-muted hover:text-ink">Open {view.kind} →</Link>
              </header>
              <div className="min-h-0 flex-1">
                <Conversation key={view.key} slug={slug} view={view} />
              </div>
            </section>
          )}
          {view && context && <ContextPanel c={context} />}
        </Card>
      )}
    </div>
  );
}
