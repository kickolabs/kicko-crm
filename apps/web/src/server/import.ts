import 'server-only';
import { Prisma, prisma, type LeadSource, type LeadStatus, type Tx, type VisaCategory } from '@kicko/db';
import { z } from 'zod';
import { cleanRow, dupKeys, LIMITS, type Cleaned, type Entity } from '@/lib/import/fields';
import { fullName } from '@/lib/format';
import { inTenant, UserError, type Scope } from './scope';

// Spreadsheet import of leads and clients. The browser parses the file and sends
// rows in chunks; every row is cleaned again here. Each import is a batch that
// remembers what it created, so it can be undone.

export const importOptions = z.object({
  entity: z.enum(['leads', 'clients']),
  fileName: z.string().trim().min(1).max(200),
  totalRows: z.number().int().min(1).max(LIMITS.rows),
  duplicates: z.enum(['skip', 'update']),
  /** Owner when the file has no owner column (or no match): unassigned, round_robin or a user id. */
  defaultOwner: z.string().max(100),
  dateOrder: z.enum(['DMY', 'MDY']),
});
export type ImportOptions = z.infer<typeof importOptions>;

const chunkInput = z.object({
  firstRow: z.number().int().min(1),
  rows: z.array(z.array(z.string().max(5000)).max(60)).min(1).max(LIMITS.chunk),
  mapping: z.record(z.string(), z.number().int().min(-1).max(59)),
});

type Match = { kind: 'lead' | 'client'; id: string; ref: string; name: string };
type Issue = { row: number; message: string };
const MAX_ISSUES = 1000;

/** Existing leads (not yet converted) and clients with any of these phone/email keys. */
async function existing(tx: Tx, keys: string[]) {
  const phones = keys.filter((k) => k.startsWith('p:')).map((k) => k.slice(2));
  const emails = keys.filter((k) => k.startsWith('e:')).map((k) => k.slice(2));
  const or = [...(phones.length ? [{ phoneNormalized: { in: phones } }] : []), ...(emails.length ? [{ email: { in: emails } }] : [])];
  const found = new Map<string, Match>();
  if (!or.length) return found;
  const sel = { id: true, ref: true, firstName: true, lastName: true, phoneNormalized: true, email: true } as const;
  const [clients, leads] = await Promise.all([
    tx.client.findMany({ where: { OR: or }, select: sel }),
    tx.lead.findMany({ where: { OR: or, clientId: null }, select: sel, orderBy: { createdAt: 'asc' } }),
  ]);
  // Clients win over leads for the same key.
  for (const [kind, rows] of [['lead', leads], ['client', clients]] as const) {
    for (const r of rows) {
      const m: Match = { kind, id: r.id, ref: r.ref, name: fullName(r) };
      for (const k of dupKeys(r)) if (kind === 'client' || !found.has(k)) found.set(k, m);
    }
  }
  return found;
}

/** For the preview: which of these keys already exist in the workspace. */
export async function findExisting(scope: Scope, keys: string[]) {
  if (keys.length > 5000) throw new UserError('Too many rows to check at once');
  const found = await inTenant(scope, (tx) => existing(tx, keys));
  return Object.fromEntries(found);
}

/** Reserve `n` sequential references, e.g. L-1043 … L-1142. */
async function reserveRefs(tx: Tx, tenantId: string, key: string, prefix: string, n: number) {
  if (!n) return [];
  const row = await tx.counter.upsert({
    where: { tenantId_key: { tenantId, key } },
    create: { tenantId, key, value: 1000 + n },
    update: { value: { increment: n } },
  });
  return Array.from({ length: n }, (_, i) => `${prefix}-${row.value - n + 1 + i}`);
}

async function teamLookup(tx: Tx) {
  const members = await tx.membership.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' }, select: { userId: true, role: true } });
  const users = await prisma.user.findMany({ where: { id: { in: members.map((m) => m.userId) } }, select: { id: true, name: true, email: true } });
  const byKey = new Map<string, string>();
  for (const u of users) {
    byKey.set(u.email.toLowerCase(), u.id);
    byKey.set(u.name.trim().toLowerCase(), u.id);
    byKey.set(u.name.trim().split(/\s+/)[0]!.toLowerCase(), u.id); // first name, if unique enough
  }
  const counsellors = members.filter((m) => m.role === 'COUNSELLOR').map((m) => m.userId);
  const pool = counsellors.length ? counsellors : members.filter((m) => m.role === 'OWNER' || m.role === 'ADMIN').map((m) => m.userId);
  return { byKey, pool, ids: new Set(members.map((m) => m.userId)) };
}

export async function startImport(scope: Scope, raw: ImportOptions) {
  const o = importOptions.parse(raw);
  return inTenant(scope, async (tx) => {
    if (o.defaultOwner !== 'unassigned' && o.defaultOwner !== 'round_robin') {
      const m = await tx.membership.findFirst({ where: { userId: o.defaultOwner, active: true } });
      if (!m) throw new UserError('That owner is not an active team member');
    }
    const running = await tx.importBatch.findFirst({ where: { status: 'running', createdAt: { gt: new Date(Date.now() - 30 * 60_000) } } });
    if (running) throw new UserError('Another import is still running. Wait for it to finish, then try again.');
    const b = await tx.importBatch.create({
      data: { tenantId: scope.tenantId, entity: o.entity, fileName: o.fileName, totalRows: o.totalRows, createdById: scope.actorId, createdIds: [], options: o },
    });
    return b.id;
  });
}

/** Only the values the file actually has: an empty cell never blanks out existing data. */
const pickDefined = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '')) as { [K in keyof T]?: NonNullable<T[K]> };

export async function importChunk(scope: Scope, batchId: string, raw: z.input<typeof chunkInput>) {
  const input = chunkInput.parse(raw);
  return inTenant(scope, async (tx) => {
    const batch = await tx.importBatch.findUnique({ where: { id: batchId } });
    if (!batch || batch.status !== 'running') throw new UserError('This import has already finished');
    const o = importOptions.parse(batch.options);
    const entity = o.entity as Entity;
    const team = await teamLookup(tx);
    let rr = batch.created; // round-robin position continues across chunks

    const issues: Issue[] = [];
    const cleaned: { row: number; data: Cleaned }[] = [];
    input.rows.forEach((cells, i) => {
      const row = input.firstRow + i;
      const r = cleanRow(entity, cells, input.mapping, { country: scope.country, dateOrder: o.dateOrder });
      if (r.ok) cleaned.push({ row, data: r.data });
      else issues.push({ row, message: r.error });
    });

    const found = await existing(tx, cleaned.flatMap((c) => dupKeys(c.data)));
    const seen = new Map<string, number>(); // key → row, for repeats inside this chunk
    const toCreate: { row: number; data: Cleaned; linkLeadId?: string }[] = [];
    let updated = 0;
    let skipped = 0;
    const now = new Date();

    const ownerOf = (d: Cleaned) => {
      if (d.owner) {
        const id = team.byKey.get(d.owner.toLowerCase());
        if (id) return id;
      }
      if (o.defaultOwner === 'round_robin') return team.pool.length ? team.pool[rr++ % team.pool.length]! : null;
      return o.defaultOwner === 'unassigned' ? null : team.ids.has(o.defaultOwner) ? o.defaultOwner : null;
    };

    for (const c of cleaned) {
      const keys = dupKeys(c.data);
      const earlier = keys.map((k) => seen.get(k)).find((r) => r !== undefined);
      if (earlier !== undefined) {
        skipped++;
        issues.push({ row: c.row, message: `Same person as row ${earlier}` });
        continue;
      }
      keys.forEach((k) => seen.set(k, c.row));
      const match = keys.map((k) => found.get(k)).find(Boolean);
      // A client import may match a lead: the client is created and the lead marked converted.
      if (match && entity === 'clients' && match.kind === 'lead') {
        toCreate.push({ ...c, linkLeadId: match.id });
        continue;
      }
      if (match && (o.duplicates === 'skip' || (entity === 'leads' && match.kind === 'client'))) {
        skipped++;
        issues.push({ row: c.row, message: match.kind === 'client' ? `Already a client (${match.ref} ${match.name})` : `Already exists (${match.ref} ${match.name})` });
        continue;
      }
      if (match) {
        await updateExisting(tx, scope, entity, match.id, c.data, ownerOf(c.data), batch.fileName);
        updated++;
        continue;
      }
      toCreate.push(c);
    }

    const createdIds = entity === 'leads' ? await createLeads(tx, scope, toCreate, ownerOf, batch.fileName, now) : await createClients(tx, scope, toCreate, ownerOf, batch.fileName, now);

    const prior = (batch.issues as unknown as Issue[]) ?? [];
    await tx.importBatch.update({
      where: { id: batchId },
      data: {
        created: { increment: createdIds.length },
        updated: { increment: updated },
        skipped: { increment: skipped },
        failed: { increment: issues.length - skipped },
        createdIds: { push: createdIds },
        issues: [...prior, ...issues].slice(0, MAX_ISSUES) as unknown as Prisma.InputJsonValue,
      },
    });
    return { created: createdIds.length, updated, skipped, failed: issues.length - skipped };
  });
}

async function updateExisting(tx: Tx, scope: Scope, entity: Entity, id: string, d: Cleaned, ownerId: string | null, fileName: string) {
  const common = pickDefined({ firstName: d.firstName, lastName: d.lastName, phone: d.phone, phoneNormalized: d.phoneNormalized, email: d.email, ownerId: d.owner ? ownerId : null });
  if (entity === 'leads') {
    await tx.lead.update({
      where: { id },
      data: { ...common, ...pickDefined({ source: d.source as LeadSource, status: d.status as LeadStatus | null, interestCountry: d.interestCountry, interestCategory: d.interestCategory as VisaCategory | null }) },
    });
  } else {
    await tx.client.update({
      where: { id },
      data: { ...common, ...pickDefined({ dob: d.dob, gender: d.gender, nationality: d.nationality, passportNumber: d.passportNumber, passportExpiry: d.passportExpiry, maritalStatus: d.maritalStatus, address: d.address }) },
    });
  }
  const key = entity === 'leads' ? 'leadId' : 'clientId';
  if (d.notes) await tx.note.create({ data: { tenantId: scope.tenantId, body: d.notes, authorId: scope.actorId, [key]: id } });
  await tx.activity.create({ data: { tenantId: scope.tenantId, actorId: scope.actorId, type: 'IMPORTED', summary: `Updated from ${fileName}`, [key]: id } });
}

type Pending = { row: number; data: Cleaned; linkLeadId?: string };

async function createLeads(tx: Tx, scope: Scope, rows: Pending[], ownerOf: (d: Cleaned) => string | null, fileName: string, now: Date) {
  const refs = await reserveRefs(tx, scope.tenantId, 'lead', 'L', rows.length);
  const created = await tx.lead.createManyAndReturn({
    select: { id: true },
    data: rows.map(({ data: d }, i) => ({
      tenantId: scope.tenantId,
      ref: refs[i]!,
      firstName: d.firstName,
      lastName: d.lastName,
      email: d.email,
      phone: d.phone,
      phoneNormalized: d.phoneNormalized,
      source: (d.source ?? 'OTHER') as LeadSource,
      status: (d.status ?? 'NEW') as LeadStatus,
      interestCountry: d.interestCountry ?? null,
      interestCategory: (d.interestCategory as VisaCategory | null) ?? null,
      ownerId: ownerOf(d),
      message: d.notes,
      createdAt: d.createdAt ?? now,
    })),
  });
  const ids = created.map((c) => c.id);
  await tx.activity.createMany({ data: ids.map((leadId) => ({ tenantId: scope.tenantId, actorId: scope.actorId, type: 'IMPORTED', summary: `Imported from ${fileName}`, leadId })) });
  return ids;
}

async function createClients(tx: Tx, scope: Scope, rows: Pending[], ownerOf: (d: Cleaned) => string | null, fileName: string, now: Date) {
  const refs = await reserveRefs(tx, scope.tenantId, 'client', 'C', rows.length);
  const created = await tx.client.createManyAndReturn({
    select: { id: true },
    data: rows.map(({ data: d }, i) => ({
      tenantId: scope.tenantId,
      ref: refs[i]!,
      firstName: d.firstName,
      lastName: d.lastName,
      email: d.email,
      phone: d.phone,
      phoneNormalized: d.phoneNormalized,
      dob: d.dob ?? null,
      gender: d.gender ?? null,
      nationality: d.nationality ?? null,
      passportNumber: d.passportNumber ?? null,
      passportExpiry: d.passportExpiry ?? null,
      maritalStatus: d.maritalStatus ?? null,
      address: d.address ?? null,
      ownerId: ownerOf(d),
      createdAt: d.createdAt ?? now,
    })),
  });
  const ids = created.map((c) => c.id);
  await tx.activity.createMany({ data: ids.map((clientId) => ({ tenantId: scope.tenantId, actorId: scope.actorId, type: 'IMPORTED', summary: `Imported from ${fileName}`, clientId })) });
  const notes = rows.flatMap((r, i) => (r.data.notes ? [{ tenantId: scope.tenantId, body: r.data.notes, authorId: scope.actorId, clientId: ids[i]! }] : []));
  if (notes.length) await tx.note.createMany({ data: notes });
  // Matching leads become converted, as if converted by hand.
  for (const [i, r] of rows.entries()) {
    if (r.linkLeadId) await tx.lead.update({ where: { id: r.linkLeadId }, data: { clientId: ids[i]!, status: 'WON' } });
  }
  return ids;
}

export async function finishImport(scope: Scope, batchId: string) {
  return inTenant(scope, async (tx) => {
    const b = await tx.importBatch.update({ where: { id: batchId }, data: { status: 'done', finishedAt: new Date() } });
    return { created: b.created, updated: b.updated, skipped: b.skipped, failed: b.failed };
  });
}

/**
 * Remove what an import created. Records that have since moved on (a lead that was
 * converted, a client with cases, invoices or payments) are kept. Updates made to
 * existing records are not reverted.
 */
export async function undoImport(scope: Scope, batchId: string) {
  return inTenant(scope, async (tx) => {
    const b = await tx.importBatch.findUnique({ where: { id: batchId } });
    if (!b) throw new UserError('Import not found');
    if (b.status === 'undone') throw new UserError('This import was already undone');
    if (b.status === 'running') throw new UserError('This import is still running');
    let removed = 0;
    if (b.entity === 'leads') {
      removed = (await tx.lead.deleteMany({ where: { id: { in: b.createdIds }, clientId: null } })).count;
    } else {
      const ids = b.createdIds;
      // Leads that this import marked as converted go back to open.
      await tx.lead.updateMany({ where: { clientId: { in: ids } , client: { cases: { none: {} }, invoices: { none: {} }, payments: { none: {} } } }, data: { clientId: null, status: 'QUALIFIED' } });
      removed = (await tx.client.deleteMany({ where: { id: { in: ids }, cases: { none: {} }, invoices: { none: {} }, payments: { none: {} } } })).count;
    }
    await tx.importBatch.update({ where: { id: batchId }, data: { status: 'undone', undoneAt: new Date(), undoneById: scope.actorId } });
    return { removed, kept: b.createdIds.length - removed };
  });
}

export async function listImports(scope: Scope) {
  return inTenant(scope, (tx) =>
    tx.importBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 20, omit: { createdIds: true } }),
  );
}
