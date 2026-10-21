import Link from 'next/link';
import { Card, CardHeader } from '@/components/ui';
import { cfDisplay, type CfEntity, type CfValues } from '@/lib/custom-fields';
import { hasFeature } from '@/lib/plans';
import { can } from '@/lib/permissions';
import type { Ctx } from '@/lib/tenant';
import { listFields } from '@/server/custom-fields';
import { scopeOf } from '@/server/scope';
import { CustomFieldsForm } from './custom-fields-form';

/**
 * "Additional details" on a lead, client or case: the agency's own fields.
 * Hidden until the agency defines some (or the record still holds values).
 */
export async function CustomFieldsPanel({ ctx, entity, recordId, values, canEdit }: { ctx: Ctx; entity: CfEntity; recordId: string; values: unknown; canEdit: boolean }) {
  const defs = await listFields(scopeOf(ctx), entity);
  const vals = (values ?? {}) as CfValues;
  // Values whose field was archived stay visible, read-only.
  const archived = Object.keys(vals).length ? (await listFields(scopeOf(ctx), entity, { archived: true })).filter((d) => d.archived && d.key in vals) : [];
  if (!defs.length && !archived.length) return null;
  const featureOn = hasFeature(ctx.subscription!, 'custom_fields');
  const editable = canEdit && featureOn && ctx.access === 'full';
  return (
    <Card>
      <CardHeader
        title="Additional details"
        action={can(ctx.role, 'settings.manage') && <Link href={`/${ctx.tenant.slug}/settings?tab=fields`} className="text-xs font-semibold text-muted hover:text-ink">Manage fields</Link>}
      />
      <div className="px-5 py-4">
        <CustomFieldsForm
          slug={ctx.tenant.slug}
          entity={entity}
          recordId={recordId}
          defs={defs.map(({ key, label, type, options }) => ({ key, label, type, options }))}
          values={vals}
          editable={editable}
        />
        {archived.length > 0 && (
          <dl className="mt-3 grid gap-x-6 gap-y-2 border-t border-line pt-3 text-[13px] sm:grid-cols-2">
            {archived.map((d) => (
              <div key={d.key}>
                <dt className="text-xs text-muted">{d.label} (archived)</dt>
                <dd>{cfDisplay(d, vals[d.key])}</dd>
              </div>
            ))}
          </dl>
        )}
        {canEdit && !featureOn && <p className="mt-3 text-xs text-muted">Editing custom fields is part of the Pro plan. Existing values stay visible.</p>}
      </div>
    </Card>
  );
}
