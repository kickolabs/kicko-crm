// Removes agencies and accounts created by automated tests (emails @example.test).
// Local databases only. Runs before each E2E run; also `npm run db:clean-test`.
import { prisma, withTenant } from '../src/index';

const TEST_EMAIL = /@example\.test$/i;

const url = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) || process.env.NODE_ENV === 'production') {
  console.error('clean-test-data only runs against a local database.');
  process.exit(1);
}

const users = await prisma.user.findMany({ where: { email: { endsWith: '@example.test' } }, select: { id: true } });
const tenantIds = new Set<string>();
for (const u of users) {
  const ms = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${u.id}, true)`;
    return tx.membership.findMany({ where: { userId: u.id }, select: { tenantId: true } });
  });
  ms.forEach((m) => tenantIds.add(m.tenantId));
}

let removed = 0;
let kept = 0;
for (const id of tenantIds) {
  // Never touch a workspace that also has a real (non-test) member.
  const members = await withTenant(id, (tx) => tx.membership.findMany({ select: { userId: true } }));
  const emails = await prisma.user.findMany({ where: { id: { in: members.map((m) => m.userId) } }, select: { email: true } });
  if (emails.some((e) => !TEST_EMAIL.test(e.email))) {
    kept++;
    continue;
  }
  await prisma.tenant.deleteMany({ where: { id } });
  removed++;
}
// Trial claims and reviews outlive accounts in real use; for test accounts, clear them too.
await prisma.trialClaim.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
await prisma.trialReview.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
const gone = await prisma.user.deleteMany({ where: { email: { endsWith: '@example.test' } } });
console.log(`Removed ${removed} test agencies and ${gone.count} test accounts${kept ? ` (kept ${kept} with real members)` : ''}.`);
await prisma.$disconnect();
