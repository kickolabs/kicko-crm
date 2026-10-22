import Link from 'next/link';
import { Card, CardHeader } from '@/components/ui';
import { branchLimit } from '@/lib/plans';
import { db, type Ctx } from '@/lib/tenant';
import { limitMessage } from '@/server/branches';
import { AddBranch, BranchRow } from './branches-forms';

export async function BranchesTab({ ctx, slug, canManagePlan }: { ctx: Ctx; slug: string; canManagePlan: boolean }) {
  const [branches, people] = await Promise.all([
    db(ctx, (tx) => tx.branch.findMany({ orderBy: { createdAt: 'asc' } })),
    db(ctx, (tx) => tx.membership.groupBy({ by: ['branchId'], where: { active: true }, _count: { _all: true } })),
  ]);
  const limit = ctx.subscription ? branchLimit(ctx.subscription) : 1;
  const trial = ctx.subscription?.status === 'trialing';
  const atLimit = branches.length >= limit;
  const count = (id: string) => people.find((p) => p.branchId === id)?._count._all ?? 0;

  return (
    <div className="flex flex-col gap-5">
      {branches.length > limit && (
        <p role="status" className="rounded-[14px] bg-warn-bg px-4 py-3 text-sm font-semibold text-warn-ink">
          You have {branches.length} branches; {limitMessage(ctx.subscription!.plan).split('.')[0]}. Existing branches keep working, but you can’t add more.
        </p>
      )}
      <Card>
        <CardHeader
          title="Branches"
          sub={
            limit === Infinity
              ? `${branches.length} branch${branches.length === 1 ? '' : 'es'}${trial ? ' · unlimited during the trial' : ' · unlimited on your plan'}`
              : `${branches.length} of ${limit} on your plan`
          }
        />
        <ul className="divide-y divide-line">
          {branches.map((b) => <BranchRow key={b.id} slug={slug} b={{ id: b.id, name: b.name, city: b.city, people: count(b.id) }} canRemove={branches.length > 1} />)}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Add a branch" sub="Each branch is an office. People, leads and cases can belong to one, and lists filter by branch." />
        {atLimit ? (
          <div className="flex flex-wrap items-center gap-3 p-5 text-sm">
            <span className="text-muted">{limitMessage(ctx.subscription?.plan ?? 'starter')}</span>
            {canManagePlan && <Link href={`/${slug}/settings?tab=plan`} className="font-bold underline underline-offset-4">See plans</Link>}
          </div>
        ) : (
          <AddBranch slug={slug} />
        )}
      </Card>
    </div>
  );
}
