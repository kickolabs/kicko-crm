import 'server-only';
import { z } from 'zod';
import { audit } from './audit';
import { decryptSecret, encryptSecret } from './secrets';
import { inTenant, logActivity, UserError, type Scope } from './scope';

// Saved logins for government and college portals (IRCC/GCKey, ImmiAccount, UKVI…).
// Passwords are encrypted at rest, never listed, exported, logged or sent to AI; showing
// one needs the vault.reveal permission and every reveal is in the audit log.

export const vaultInput = z.object({
  label: z.string().trim().min(2, 'Which portal?').max(80),
  portalUrl: z.string().trim().max(300).optional().transform((v) => v || null).pipe(z.url('Enter the portal address').nullable()),
  username: z.string().trim().min(1, 'Add the username or email').max(200),
  secret: z.string().max(500).optional(),
  notes: z.string().trim().max(1000).optional().transform((v) => v || null),
  caseId: z.string().optional().transform((v) => v || null),
});

/** Entries for a client, without secrets. */
export function listVault(scope: Scope, clientId: string) {
  return inTenant(scope, (tx) =>
    tx.credentialVault.findMany({
      where: { clientId },
      select: { id: true, label: true, portalUrl: true, username: true, notes: true, caseId: true, lastRevealedAt: true, updatedAt: true },
      orderBy: { label: 'asc' },
    }),
  );
}

export async function saveVaultEntry(scope: Scope, clientId: string, raw: z.input<typeof vaultInput>, id?: string) {
  const input = vaultInput.parse(raw);
  if (!id && !input.secret) throw new UserError('Add the password', 'secret');
  const entry = await inTenant(scope, async (tx) => {
    if (!(await tx.client.findUnique({ where: { id: clientId } }))) throw new UserError('Client not found');
    if (input.caseId && !(await tx.case.findFirst({ where: { id: input.caseId, clientId } }))) throw new UserError('Case not found');
    const data = {
      label: input.label,
      portalUrl: input.portalUrl,
      username: input.username,
      notes: input.notes,
      caseId: input.caseId,
      ...(input.secret ? { secret: encryptSecret(input.secret) } : {}),
    };
    const saved = id
      ? await tx.credentialVault.update({ where: { id }, data })
      : await tx.credentialVault.create({ data: { tenantId: scope.tenantId, clientId, createdBy: scope.actorId, ...data, secret: encryptSecret(input.secret!) } });
    await logActivity(tx, scope, { type: 'VAULT', summary: `${id ? 'Updated' : 'Saved'} ${input.label} login`, clientId });
    return saved;
  });
  await audit(scope, 'document.vault_saved', `${id ? 'Updated' : 'Saved'} a portal login (${input.label})`, { entryId: entry.id, clientId });
  return entry.id;
}

/** The password, for someone allowed to see it. Audited every time. */
export async function revealVaultEntry(scope: Scope, id: string) {
  const row = await inTenant(scope, async (tx) => {
    const e = await tx.credentialVault.findUnique({ where: { id } });
    if (!e) throw new UserError('Not found');
    await tx.credentialVault.update({ where: { id }, data: { lastRevealedAt: new Date() } });
    return e;
  });
  await audit(scope, 'document.vault_revealed', `Viewed the ${row.label} password`, { entryId: id, clientId: row.clientId });
  const secret = decryptSecret(row.secret);
  if (secret == null) throw new UserError('This password could not be decrypted. Save it again.');
  return secret;
}

export async function deleteVaultEntry(scope: Scope, id: string) {
  const row = await inTenant(scope, async (tx) => {
    const e = await tx.credentialVault.findUnique({ where: { id } });
    if (!e) throw new UserError('Not found');
    await tx.credentialVault.delete({ where: { id } });
    return e;
  });
  await audit(scope, 'document.vault_deleted', `Deleted the ${row.label} login`, { clientId: row.clientId });
}
