import Link from 'next/link';
import { ActionButton } from '@/components/forms';
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import { can } from '@/lib/permissions';
import { getCtx, getTeam } from '@/lib/tenant';
import { listImports } from '@/server/import';
import { scopeOf } from '@/server/scope';
import { undoImportAction } from '../actions-import';
import { ImportWizard } from './import-wizard';

export const metadata = { title: 'Import' };

type Issue = { row: number; message: string };

export default async function ImportPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ type?: string }> }) {
  const { tenant: slug } = await params;
  const { type } = await searchParams;
  const ctx = await getCtx(slug);
  if (!can(ctx.role, 'settings.manage')) {
    return (
      <div className="mx-auto max-w-[900px]">
        <Card><EmptyState title="Ask an owner or admin" body="Importing from a spreadsheet adds many records at once, so only owners and admins can do it." /></Card>
      </div>
    );
  }
  const [team, imports] = await Promise.all([getTeam(ctx), listImports(scopeOf(ctx))]);
  const tz = ctx.tenant.timezone;
  const names = Object.fromEntries(team.map((m) => [m.userId, m.name]));

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
      <PageHeader title="Import" sub="Bring in leads or clients from Excel, Zoho or any CRM that exports CSV." />
      <ImportWizard
        slug={slug}
        team={team.filter((m) => m.role !== 'ACCOUNTS').map((m) => ({ userId: m.userId, name: m.name }))}
        country={ctx.tenant.country}
        initialEntity={type === 'clients' ? 'clients' : 'leads'}
      />

      <Card>
        <CardHeader title="Past imports" sub="Undo removes what an import created, except records that have moved on since (converted leads, clients with cases or invoices)." />
        {imports.length === 0 ? (
          <EmptyState title="No imports yet" />
        ) : (
          <ul className="divide-y divide-line">
            {imports.map((b) => {
              const issues = (b.issues as unknown as Issue[]) ?? [];
              return (
                <li key={b.id} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 font-semibold">
                      {b.fileName}
                      <Badge>{b.entity === 'leads' ? 'Leads' : 'Clients'}</Badge>
                      {b.status === 'undone' && <Badge tone="warn">Undone</Badge>}
                      {b.status === 'running' && <Badge tone="info">Running</Badge>}
                    </div>
                    <div className="text-xs text-muted">
                      {fmtDateTime(b.createdAt, tz)} · {b.createdById ? names[b.createdById] ?? 'Former member' : 'System'} · {b.totalRows.toLocaleString('en-IN')} rows: {b.created.toLocaleString('en-IN')} created, {b.updated} updated, {b.skipped} skipped, {b.failed} failed
                    </div>
                    {issues.length > 0 && (
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer font-semibold text-ink-2">{issues.length >= 1000 ? 'First 1,000' : issues.length} row{issues.length === 1 ? '' : 's'} not imported</summary>
                        <ul className="mt-1 max-h-48 overflow-auto text-muted">
                          {issues.map((i) => <li key={`${i.row}-${i.message}`}>Row {i.row}: {i.message}</li>)}
                        </ul>
                      </details>
                    )}
                  </div>
                  {b.status === 'done' && b.created > 0 && (
                    <ActionButton action={undoImportAction.bind(null, slug, b.id)} variant="ghost" confirm={`Remove the ${b.created} ${b.entity} this import created?`}>
                      Undo
                    </ActionButton>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <p className="text-xs text-muted">
        Tip: a client import also converts matching leads. <Link href={`/${slug}/settings?tab=team`} className="underline">Team members</Link> are matched by email or name in an Owner column.
      </p>
    </div>
  );
}
