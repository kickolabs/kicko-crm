import 'server-only';
import type { AdLead } from '@/integrations/lead-ads/port';
import { splitName } from '@/lib/import/fields';
import { createLead } from './leads';
import { inTenant, type Scope } from './scope';

// Lead-ad submissions become leads (source "Ads"), with the campaign, form and ad kept as
// UTM data and every answer in the enquiry text. An enquiry from someone we already know
// is attached to their record; a resent webhook for the same lead id is ignored.

export async function processAdLeads(scope: Scope, leads: AdLead[], provider: string) {
  let created = 0;
  for (const l of leads) {
    const seen = await inTenant(scope, (tx) => tx.lead.findFirst({ where: { utm: { path: ['adLeadId'], equals: l.externalId } }, select: { id: true } }));
    if (seen) continue;
    const name = l.fields.firstName ? { firstName: l.fields.firstName, lastName: l.fields.lastName ?? null } : splitName(l.fields.fullName ?? '');
    if (!name.firstName || (!l.fields.phone && !l.fields.email)) continue; // a lead form always asks for one of them
    const answers = Object.entries(l.answers).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('\n');
    const res = await createLead(
      scope,
      {
        firstName: name.firstName.slice(0, 80),
        lastName: name.lastName ?? undefined,
        email: l.fields.email,
        phone: l.fields.phone,
        interestCountry: l.fields.country,
        message: [l.fields.message, answers].filter(Boolean).join('\n\n').slice(0, 4000),
        source: 'ADS',
      },
      { mergeDuplicates: true, utm: { adLeadId: l.externalId, provider, ...(l.campaign ? { campaign: l.campaign } : {}), ...(l.form ? { form: l.form } : {}), ...(l.ad ? { ad: l.ad } : {}) } },
    );
    if (res.status === 'created') created++;
  }
  return created;
}
