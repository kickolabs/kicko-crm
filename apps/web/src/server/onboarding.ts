import 'server-only';
import type { LeadSource, LeadStatus, VisaCategory } from '@kicko/db';
import { prisma } from '@kicko/db';
import type { TenantSettings } from '@kicko/db/provision';
import type { Ctx } from '@/lib/tenant';
import { db } from '@/lib/tenant';
import { normalizePhone } from '@/lib/phone';
import { audit } from './audit';
import { reserveRefs, undoImport } from './import';
import { inTenant, UserError, type Scope } from './scope';

// "Get started" checklist for new agencies, and optional sample leads so a fresh
// trial isn't an empty screen. Sample leads are an import batch, so removing them
// uses the same undo as any import.

export const SAMPLE_FILE = 'Sample leads';

export type Step = { key: string; title: string; href: string; done: boolean };

export async function onboarding(ctx: Ctx) {
  const slug = ctx.tenant.slug;
  const s = ctx.tenant.settings;
  const sampleBatch = await db(ctx, (tx) => tx.importBatch.findFirst({ where: { fileName: SAMPLE_FILE, status: 'done' }, select: { id: true, createdIds: true } }));
  // Sample leads never count as the agency's own progress.
  const notSample = sampleBatch ? { id: { notIn: sampleBatch.createdIds } } : {};
  const [members, invites, realLeads, webLeads, whatsapp, user] = await Promise.all([
    db(ctx, (tx) => tx.membership.count({ where: { active: true } })),
    db(ctx, (tx) => tx.invite.count({ where: { acceptedAt: null, expiresAt: { gt: new Date() } } })),
    db(ctx, (tx) => tx.lead.count({ where: notSample })),
    db(ctx, (tx) => tx.lead.count({ where: { source: 'WEB_FORM', ...notSample } })),
    db(ctx, (tx) => tx.providerConnection.count({ where: { capability: 'messaging' } })),
    prisma.user.findUnique({ where: { id: ctx.user.id }, select: { twoFactorEnabled: true } }),
  ]);
  const steps: Step[] = [
    { key: 'details', title: 'Add your agency’s invoice details (legal name, GSTIN)', href: `/${slug}/settings?tab=billing`, done: Boolean(s.billing?.legalName) },
    { key: 'team', title: 'Invite your team', href: `/${slug}/settings?tab=team`, done: members > 1 || invites > 0 },
    { key: 'leads', title: 'Bring in your leads from Excel or another CRM', href: `/${slug}/import`, done: realLeads > 0 },
    { key: 'form', title: 'Put the enquiry form on your website', href: `/${slug}/settings?tab=capture`, done: webLeads > 0 },
    { key: 'whatsapp', title: 'Connect your WhatsApp Business number', href: `/${slug}/settings?tab=whatsapp`, done: whatsapp > 0 },
    { key: '2fa', title: 'Turn on two-step sign-in', href: '/account', done: Boolean(user?.twoFactorEnabled) },
    { key: 'plan', title: 'Choose a plan', href: `/${slug}/settings?tab=plan`, done: ctx.subscription?.status === 'active' },
  ];
  const done = steps.filter((x) => x.done).length;
  return { steps, done, total: steps.length, show: !s.onboarding?.dismissed && done < steps.length, sampleBatchId: sampleBatch?.id ?? null, canAddSample: !sampleBatch && realLeads === 0 };
}

const SAMPLE: [first: string, last: string, phone: string, source: LeadSource, status: LeadStatus, country: string, cat: VisaCategory, daysAgo: number, note: string][] = [
  ['Priya', 'Sharma', '9840100201', 'WHATSAPP', 'CONSULT_BOOKED', 'CA', 'STUDY', 2, 'MSc Data Science, Sept intake. IELTS 7.5.'],
  ['Arjun', 'Mehta', '9840100202', 'ADS', 'CONTACTED', 'AU', 'PR', 4, 'Software engineer, 6 years. Asked about subclass 189 points.'],
  ['Kavya', 'Reddy', '9840100203', 'WEB_FORM', 'NEW', 'GB', 'STUDY', 1, 'Nursing, Jan intake. Budget ₹25 lakh.'],
  ['Rahul', 'Verma', '9840100204', 'WALK_IN', 'QUALIFIED', 'CA', 'PR', 9, 'Express Entry, CRS around 470. Spouse has IELTS 7.'],
  ['Sneha', 'Iyer', '9840100205', 'REFERRAL', 'WON', 'NZ', 'STUDY', 21, 'Referred by an alumni client. Signed the Canterbury package.'],
  ['Mohammed', 'Faisal', '9840100206', 'CALL', 'CONTACTED', 'DE', 'WORK', 6, 'Mechanical engineer, wants the Opportunity Card.'],
  ['Divya', 'Nair', '9840100207', 'WHATSAPP', 'NEW', 'US', 'VISIT', 0, 'Parents visiting for graduation in May.'],
  ['Karthik', 'Subramanian', '9840100208', 'ADS', 'LOST', 'AU', 'STUDY', 30, 'Chose a cheaper agency. Ask again next intake.'],
  ['Ananya', 'Gupta', '9840100209', 'WEB_FORM', 'QUALIFIED', 'IE', 'STUDY', 12, 'MBA, GMAT 680. Wants scholarships.'],
  ['Vikram', 'Singh', '9840100210', 'WALK_IN', 'CONSULT_BOOKED', 'CA', 'FAMILY', 3, 'Spousal sponsorship for his wife.'],
  ['Meera', 'Krishnan', '9840100211', 'REFERRAL', 'WON', 'GB', 'WORK', 40, 'Skilled Worker visa, NHS offer letter.'],
  ['Rohan', 'Das', '9840100212', 'CALL', 'NEW', 'AU', 'STUDY', 1, 'Diploma in hospitality, Feb intake.'],
];

export async function addSampleLeads(scope: Scope) {
  const id = await inTenant(scope, async (tx) => {
    if (await tx.importBatch.findFirst({ where: { fileName: SAMPLE_FILE, status: 'done' } })) throw new UserError('Sample leads are already added');
    const refs = await reserveRefs(tx, scope.tenantId, 'lead', 'L', SAMPLE.length);
    const now = Date.now();
    const created = await tx.lead.createManyAndReturn({
      select: { id: true },
      data: SAMPLE.map(([firstName, lastName, phone, source, status, interestCountry, interestCategory, daysAgo, message], i) => ({
        tenantId: scope.tenantId,
        ref: refs[i]!,
        firstName,
        lastName,
        phone,
        phoneNormalized: normalizePhone(phone, 'IN'),
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
        source,
        status,
        interestCountry,
        interestCategory,
        ownerId: scope.actorId,
        message: `Sample lead: ${message}`,
        createdAt: new Date(now - daysAgo * 86400_000 - i * 3600_000),
      })),
    });
    const ids = created.map((c) => c.id);
    const b = await tx.importBatch.create({
      data: { tenantId: scope.tenantId, entity: 'leads', fileName: SAMPLE_FILE, createdById: scope.actorId, status: 'done', totalRows: ids.length, created: ids.length, createdIds: ids, finishedAt: new Date() },
    });
    return b.id;
  });
  await audit(scope, 'data.import', `Added ${SAMPLE.length} sample leads`);
  return id;
}

export async function removeSampleLeads(scope: Scope) {
  const b = await inTenant(scope, (tx) => tx.importBatch.findFirst({ where: { fileName: SAMPLE_FILE, status: 'done' } }));
  if (!b) throw new UserError('There are no sample leads');
  return undoImport(scope, b.id);
}

export async function dismissOnboarding(scope: Scope) {
  const settings: TenantSettings = { ...scope.settings, onboarding: { dismissed: true } };
  await prisma.tenant.update({ where: { id: scope.tenantId }, data: { settings } });
}
