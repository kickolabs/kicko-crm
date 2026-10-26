import 'server-only';
import { prisma, type Tx } from '@kicko/db';
import { notifyTx } from './rules';
import { inTenant, type Scope } from './scope';

// The bell: mentions, assignments, automations, reminders and stage deadlines.

export async function myNotifications(scope: Scope, userId: string, take = 15) {
  return inTenant(scope, async (tx) => ({
    items: await tx.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take }),
    unread: await tx.notification.count({ where: { userId, readAt: null } }),
  }));
}

export async function markRead(scope: Scope, userId: string, id?: string) {
  await inTenant(scope, (tx) => tx.notification.updateMany({ where: { userId, readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date() } }));
}

/**
 * People @mentioned in a note get a notification: "@Divya" or "@Divya Raman" (first name,
 * or full name when two people share a first name).
 */
export async function notifyMentions(tx: Tx, scope: Scope, body: string, href: string | null) {
  if (!body.includes('@')) return [];
  const members = await tx.membership.findMany({ where: { active: true }, select: { userId: true } });
  const users = await prisma.user.findMany({ where: { id: { in: members.map((m) => m.userId) } }, select: { id: true, name: true } });
  const text = body.toLowerCase();
  const firstCount = new Map<string, number>();
  for (const u of users) {
    const f = u.name.split(/\s+/)[0]!.toLowerCase();
    firstCount.set(f, (firstCount.get(f) ?? 0) + 1);
  }
  const mentioned = users.filter((u) => {
    const full = u.name.toLowerCase();
    const first = full.split(/\s+/)[0]!;
    const boundary = (s: string) => new RegExp(`@${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(text);
    return boundary(full) || (firstCount.get(first) === 1 && boundary(first));
  });
  const author = scope.actorId ? users.find((u) => u.id === scope.actorId)?.name : null;
  await notifyTx(tx, scope, mentioned.map((u) => u.id), { kind: 'mention', text: `${author ?? 'Someone'} mentioned you: ${body.length > 120 ? `${body.slice(0, 120)}…` : body}`, href });
  return mentioned.map((u) => u.id);
}
