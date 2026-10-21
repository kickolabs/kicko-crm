import Link from 'next/link';
import { Download, ShieldCheck, ShieldOff } from 'lucide-react';
import { prisma } from '@kicko/db';
import { ActionButton } from '@/components/forms';
import { Badge, buttonCls, Card, CardHeader, EmptyState, Select } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import { ROLE_LABEL } from '@/lib/permissions';
import type { Ctx } from '@/lib/tenant';
import { getTeam } from '@/lib/tenant';
import { AUDIT_GROUPS, deviceName, listAudit } from '@/server/audit';
import { setRequire2faAction } from '../actions-phase7';

/** Settings → Security: two-step sign-in policy, data export and the audit log. */
export async function SecurityTab({ ctx, sp }: { ctx: Ctx; sp: { group?: string; person?: string; before?: string } }) {
  const slug = ctx.tenant.slug;
  const tz = ctx.tenant.timezone;
  const team = await getTeam(ctx);
  const twoStep = new Map(
    (await prisma.user.findMany({ where: { id: { in: team.map((m) => m.userId) } }, select: { id: true, twoFactorEnabled: true } })).map((u) => [u.id, Boolean(u.twoFactorEnabled)]),
  );
  const required = Boolean(ctx.tenant.settings.security?.require2fa);
  const before = sp.before && !Number.isNaN(Date.parse(sp.before)) ? new Date(sp.before) : undefined;
  const group = AUDIT_GROUPS.some((g) => g.key === sp.group) ? sp.group : undefined;
  const events = await listAudit(ctx.tenant.id, { group, actorId: sp.person || undefined, before, take: 100 });
  const without = team.filter((m) => !twoStep.get(m.userId)).length;
  const qs = (patch: Record<string, string | undefined>) =>
    `?${new URLSearchParams(Object.entries({ tab: 'security', group, person: sp.person, ...patch }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title="Two-step sign-in"
          sub={required ? 'Required for everyone. People without it are asked to set it up before they can continue.' : `${team.length - without} of ${team.length} use it`}
          action={
            required ? (
              <ActionButton action={setRequire2faAction.bind(null, slug, false)} confirm="Stop requiring two-step sign-in for the team?">Stop requiring</ActionButton>
            ) : (
              <ActionButton action={setRequire2faAction.bind(null, slug, true)} variant="primary" confirm={`Require two-step sign-in for everyone?${without ? ` ${without} member${without === 1 ? '' : 's'} will be asked to set it up next time they open Kicko.` : ''}`}>
                Require for everyone
              </ActionButton>
            )
          }
        />
        <ul className="divide-y divide-line">
          {team.map((m) => (
            <li key={m.userId} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate"><span className="font-semibold">{m.name}</span> <span className="text-muted">· {ROLE_LABEL[m.role]}</span></span>
              {twoStep.get(m.userId) ? <Badge tone="ok"><ShieldCheck size={12} aria-hidden="true" /> On</Badge> : <Badge tone="warn"><ShieldOff size={12} aria-hidden="true" /> Off</Badge>}
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-5 py-3 text-xs text-muted">Each person turns it on in <Link href="/account" className="font-semibold text-ink underline">My account & security</Link>.</p>
      </Card>

      <Card>
        <CardHeader title="Export all data" sub="Everything your agency has in Kicko as CSV files in a ZIP: leads, clients, cases, invoices, payments, messages and more. Yours to keep, any time." />
        <div className="px-5 py-4">
          <a href={`/api/t/${slug}/export`} className={buttonCls('secondary')} download><Download size={15} aria-hidden="true" /> Download ZIP</a>
        </div>
      </Card>

      <Card>
        <CardHeader title="Audit log" sub="Sign-ins, team and settings changes, exports, imports and who opened which client document. Entries can’t be edited or deleted." />
        <form className="flex flex-wrap items-end gap-3 border-b border-line px-5 py-3" action="">
          <input type="hidden" name="tab" value="security" />
          <Select name="group" defaultValue={group ?? ''} aria-label="Type of event" className="h-9 w-48">
            <option value="">All events</option>
            {AUDIT_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </Select>
          <Select name="person" defaultValue={sp.person ?? ''} aria-label="Person" className="h-9 w-48">
            <option value="">Everyone</option>
            {team.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </Select>
          <button type="submit" className={buttonCls('secondary', 'sm')}>Filter</button>
        </form>
        {events.length === 0 ? (
          <EmptyState title="Nothing logged yet" body="Events appear here as your team uses Kicko." />
        ) : (
          <ul className="divide-y divide-line" aria-label="Audit events">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-2.5 text-sm">
                <span className="w-36 shrink-0 text-xs text-muted tabular-nums">{fmtDateTime(e.createdAt, tz)}</span>
                <span className="min-w-0 flex-1">{e.summary}</span>
                <span className="text-xs text-muted">
                  {e.actorEmail ?? (e.action.startsWith('billing.kicko') ? 'Kicko support' : 'System')}
                  {e.ip || e.userAgent ? ` · ${[e.ip, e.userAgent && deviceName(e.userAgent)].filter(Boolean).join(' · ')}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        {events.length === 100 && (
          <div className="border-t border-line px-5 py-3 text-sm">
            <Link href={qs({ before: events.at(-1)!.createdAt.toISOString() })} className="font-semibold text-ink underline">Older events</Link>
          </div>
        )}
      </Card>
    </div>
  );
}
