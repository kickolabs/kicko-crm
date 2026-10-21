import 'server-only';
import { prisma, type Prisma } from '@kicko/db';
import { z } from 'zod';
import { fullName } from '@/lib/format';
import { db, type Ctx } from '@/lib/tenant';
import { emailEnabled, sendEmail } from './email';
import { inTenant, UserError, type Scope } from './scope';
import type { Contact } from './whatsapp/service';

// Staff side of messaging. A conversation belongs to a contact: a client, or a
// lead who hasn't converted yet (WhatsApp enquiries start as leads).

export const contactKey = (c: Contact) => `${c.kind}:${c.id}`;

export function parseContactKey(key: string | undefined | null): Contact | null {
  const m = key?.match(/^(client|lead):([a-z0-9]+)$/);
  return m ? { kind: m[1] as Contact['kind'], id: m[2]! } : null;
}

const whereContact = (c: Contact): Prisma.MessageWhereInput => (c.kind === 'client' ? { clientId: c.id } : { leadId: c.id, clientId: null });

export const staffMessageInput = z.object({ body: z.string().trim().min(1, 'Write a message').max(4000) });

/** Portal message (clients only). */
export async function sendStaffMessage(scope: Scope, slug: string, tenantName: string, clientId: string, raw: unknown) {
  const { body } = staffMessageInput.parse(raw);
  const client = await inTenant(scope, async (tx) => {
    const c = await tx.client.findUnique({ where: { id: clientId } });
    if (!c) throw new UserError('Client not found');
    await tx.message.create({
      data: { tenantId: scope.tenantId, clientId, channel: 'PORTAL', direction: 'OUTBOUND', body, authorId: scope.actorId },
    });
    await tx.message.updateMany({ where: { clientId, direction: 'INBOUND', readAt: null }, data: { readAt: new Date() } });
    return c;
  });
  // Nudge by email when the client has portal access (no message content in the email).
  if (client.email && client.portalInvitedAt && emailEnabled()) {
    await sendEmail({
      to: client.email,
      subject: `New message from ${tenantName}`,
      text: `Hi ${client.firstName},\n\nYou have a new message from ${tenantName}. Open your portal to read and reply:\n\n${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/portal/${slug}/messages`,
    });
  }
}

export function markThreadRead(scope: Scope, contact: Contact) {
  return inTenant(scope, (tx) =>
    tx.message.updateMany({ where: { ...whereContact(contact), direction: 'INBOUND', readAt: null }, data: { readAt: new Date() } }),
  );
}

export function getThread(ctx: Ctx, contact: Contact) {
  return db(ctx, (tx) => tx.message.findMany({ where: whereContact(contact), orderBy: { createdAt: 'asc' }, take: 500 }));
}

export type ThreadSummary = {
  key: string;
  contact: Contact;
  name: string;
  ref: string;
  phone: string | null;
  ownerId: string | null;
  last: { body: string; direction: 'INBOUND' | 'OUTBOUND'; channel: string; at: Date };
  unread: number;
};

/** Inbox: one row per contact with their latest message and unread count. */
export async function listThreads(ctx: Ctx, filter: 'all' | 'unread' | 'mine' | 'whatsapp' = 'all'): Promise<ThreadSummary[]> {
  return db(ctx, async (tx) => {
    const heads = await tx.message.groupBy({
      by: ['clientId', 'leadId'],
      where: filter === 'whatsapp' ? { channel: 'WHATSAPP' } : {},
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: 'desc' } },
      take: 300,
    });
    if (!heads.length) return [];
    const latest = await tx.message.findMany({
      where: { OR: heads.map((h) => ({ clientId: h.clientId, leadId: h.leadId, createdAt: h._max.createdAt! })) },
      include: { client: true, lead: true },
    });
    const unread = await tx.message.groupBy({ by: ['clientId', 'leadId'], where: { direction: 'INBOUND', readAt: null }, _count: { _all: true } });

    // Converted leads: a client thread absorbs the lead's messages.
    const seen = new Set<string>();
    const rows: ThreadSummary[] = [];
    for (const m of latest.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
      const contact: Contact = m.clientId ? { kind: 'client', id: m.clientId } : { kind: 'lead', id: m.leadId! };
      const key = contactKey(contact);
      if (seen.has(key)) continue;
      seen.add(key);
      const who = m.client ?? m.lead!;
      rows.push({
        key,
        contact,
        name: fullName(who),
        ref: who.ref,
        phone: who.phoneNormalized,
        ownerId: who.ownerId,
        last: { body: m.body, direction: m.direction, channel: m.channel, at: m.createdAt },
        unread: unread
          .filter((u) => (contact.kind === 'client' ? u.clientId === contact.id : u.leadId === contact.id && !u.clientId))
          .reduce((a, u) => a + u._count._all, 0),
      });
    }
    return rows.filter((t) => (filter === 'unread' ? t.unread > 0 : filter === 'mine' ? t.ownerId === ctx.user.id : true));
  });
}

export async function staffNames(ids: (string | null)[]) {
  const users = await prisma.user.findMany({ where: { id: { in: ids.filter(Boolean) as string[] } }, select: { id: true, name: true } });
  return Object.fromEntries(users.map((u) => [u.id, u.name]));
}
