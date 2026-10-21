import { PrismaClient, Prisma } from '@prisma/client';

export * from '@prisma/client';

const globalForPrisma = globalThis as unknown as { __kickoPrisma?: PrismaClient };

/**
 * Raw client. Tenant-scoped tables return NO rows through it (RLS denies when
 * app.tenant_id is unset), so use it only for global tables: Tenant and the
 * Better-Auth tables.
 */
export const prisma: PrismaClient =
  globalForPrisma.__kickoPrisma ??
  new PrismaClient({ log: process.env.PRISMA_LOG ? ['query', 'error'] : ['error'] });

if (process.env.NODE_ENV !== 'production') globalForPrisma.__kickoPrisma = prisma;

export type Tx = Prisma.TransactionClient;

/**
 * Run `fn` inside a transaction bound to one tenant. Postgres RLS policies read
 * app.tenant_id, so every query in `fn` can only see and write this tenant's rows.
 */
export function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!tenantId) throw new Error('withTenant: tenantId is required');
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}

/** Next sequential human reference for a tenant, e.g. nextRef(tx, t, 'lead', 'L') → "L-1001". */
export async function nextRef(tx: Tx, tenantId: string, key: string, prefix: string): Promise<string> {
  const row = await tx.counter.upsert({
    where: { tenantId_key: { tenantId, key } },
    create: { tenantId, key, value: 1001 },
    update: { value: { increment: 1 } },
  });
  return `${prefix}-${row.value}`;
}
