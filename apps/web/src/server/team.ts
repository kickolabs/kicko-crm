import 'server-only';
import { randomBytes } from 'node:crypto';
import { prisma, withTenant, type Role } from '@kicko/db';
import { z } from 'zod';
import { assertSeatAvailable } from './plan';
import { normalizeEmail } from '@/lib/phone';
import { ROLE_LABEL } from '@/lib/permissions';
import { audit } from './audit';
import { inTenant, UserError, type Scope } from './scope';

const INVITE_DAYS = 7;

export const inviteInput = z.object({
  email: z.email('Enter a valid email'),
  role: z.enum(['ADMIN', 'COUNSELLOR', 'DOC_OFFICER', 'ACCOUNTS']),
});

export async function createInvite(scope: Scope, raw: z.input<typeof inviteInput>) {
  const input = inviteInput.parse(raw);
  const email = normalizeEmail(input.email)!;
  const user = await prisma.user.findUnique({ where: { email } });
  const invite = await inTenant(scope, async (tx) => {
    await assertSeatAvailable(tx, scope.tenantId);
    if (user) {
      const m = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: scope.tenantId, userId: user.id } } });
      if (m?.active) throw new UserError('That person is already on the team');
    }
    await tx.invite.deleteMany({ where: { email, acceptedAt: null } });
    return tx.invite.create({
      data: {
        tenantId: scope.tenantId,
        email,
        role: input.role as Role,
        token: randomBytes(24).toString('base64url'),
        invitedBy: scope.actorId!,
        expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000),
      },
    });
  });
  await audit(scope, 'team.invited', `Invited ${email} as ${ROLE_LABEL[input.role as Role]}`);
  return invite;
}

export async function revokeInvite(scope: Scope, inviteId: string) {
  const inv = await inTenant(scope, async (tx) => {
    const i = await tx.invite.findUnique({ where: { id: inviteId } });
    await tx.invite.deleteMany({ where: { id: inviteId, acceptedAt: null } });
    return i;
  });
  if (inv) await audit(scope, 'team.invite_revoked', `Cancelled the invite for ${inv.email}`);
}

export async function getInvite(tenantId: string, token: string) {
  const invite = await withTenant(tenantId, (tx) => tx.invite.findUnique({ where: { token } }));
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) return null;
  return invite;
}

/** Accept an invite as the signed-in user; their email must match the invite. */
export async function acceptInvite(tenantId: string, token: string, user: { id: string; email: string }) {
  return withTenant(tenantId, async (tx) => {
    const invite = await tx.invite.findUnique({ where: { token } });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) throw new UserError('This invite has expired');
    if (invite.email !== user.email.toLowerCase()) {
      throw new UserError(`This invite is for ${invite.email}. Sign in with that email to accept it.`);
    }
    await tx.membership.upsert({
      where: { tenantId_userId: { tenantId, userId: user.id } },
      create: { tenantId, userId: user.id, role: invite.role },
      update: { role: invite.role, active: true },
    });
    await tx.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    return invite.role;
  }).then(async (role) => {
    await audit({ tenantId, actorId: user.id }, 'team.joined', `${user.email} joined as ${ROLE_LABEL[role]}`);
  });
}

export async function updateMember(scope: Scope, userId: string, patch: { role?: Role; active?: boolean }) {
  return inTenant(scope, async (tx) => {
    const m = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: scope.tenantId, userId } } });
    if (!m) throw new UserError('Member not found');
    const owners = await tx.membership.count({ where: { role: 'OWNER', active: true } });
    const losingOwner = m.role === 'OWNER' && m.active && (patch.active === false || (patch.role && patch.role !== 'OWNER'));
    if (losingOwner && owners <= 1) throw new UserError('A workspace needs at least one owner');
    if (userId === scope.actorId && patch.active === false) throw new UserError("You can't deactivate yourself");
    await tx.membership.update({ where: { id: m.id }, data: patch });
    return m;
  }).then(async (m) => {
    const who = (await prisma.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email ?? 'a member';
    if (patch.role && patch.role !== m.role) await audit(scope, 'team.role_changed', `Changed ${who} from ${ROLE_LABEL[m.role]} to ${ROLE_LABEL[patch.role]}`);
    if (patch.active === false && m.active) await audit(scope, 'team.deactivated', `Deactivated ${who}`);
    if (patch.active === true && !m.active) await audit(scope, 'team.reactivated', `Reactivated ${who}`);
  });
}
