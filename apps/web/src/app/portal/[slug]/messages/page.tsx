import { fmtDateTime } from '@/lib/format';
import { prisma } from '@kicko/db';
import { portalMessages } from '@/server/portal';
import { requirePortal } from '@/server/portal-auth';
import { PortalShell } from '../portal-shell';
import { ChatBox } from './chat-box';

export const metadata = { title: 'Messages', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function PortalMessages({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await requirePortal(slug);
  const messages = await portalMessages(p);
  const authors = await prisma.user.findMany({
    where: { id: { in: messages.map((m) => m.authorId).filter(Boolean) as string[] } },
    select: { id: true, name: true },
  });
  const nameOf = Object.fromEntries(authors.map((a) => [a.id, a.name]));

  return (
    <PortalShell slug={slug} agency={p.tenantName} active="messages">
      <section className="card mx-auto flex w-full max-w-3xl flex-col">
        <header className="border-b border-line px-6 py-4">
          <h1 className="text-xl font-extrabold tracking-tight">Messages</h1>
          <p className="text-sm text-muted">Talk to your consultant at {p.tenantName}. We usually reply within a working day.</p>
        </header>
        <ol className="flex max-h-[60vh] min-h-64 flex-col gap-3 overflow-y-auto px-6 py-5" aria-live="polite">
          {messages.length === 0 && <li className="m-auto text-sm text-muted">No messages yet. Say hello.</li>}
          {messages.map((m) => {
            const mine = m.direction === 'INBOUND';
            return (
              <li key={m.id} className={`flex max-w-[80%] flex-col gap-1 ${mine ? 'self-end items-end' : 'self-start'}`}>
                <div className={`rounded-[16px] px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-line ${mine ? 'rounded-br-[4px] bg-ink text-paper' : 'rounded-bl-[4px] bg-paper-3'}`}>{m.body}</div>
                <span className="text-[11px] text-muted">
                  {mine ? 'You' : (m.authorId && nameOf[m.authorId]) || p.tenantName} · {fmtDateTime(m.createdAt, p.scope.timezone)}{m.channel === 'WHATSAPP' ? ' · via WhatsApp' : ''}
                </span>
              </li>
            );
          })}
        </ol>
        <div className="border-t border-line p-4">
          <ChatBox slug={slug} />
        </div>
      </section>
    </PortalShell>
  );
}
