import 'server-only';
import { prisma, type Prisma, type Tx } from '@kicko/db';
import { z } from 'zod';
import { matchCandidate, type CandidateProfile, type Eligibility, type OpeningNeeds } from '@/lib/matching';
import type { PackValues } from '@/lib/pack-fields';
import { openCaseTx } from './cases';
import { libraryList, tenantPack } from './library';
import { inTenant, logActivity, UserError, type Scope } from './scope';

// Organizations and their openings, with a candidate pipeline. Industry-neutral: the
// immigration pack calls them employers and vacancies. Hiring a candidate links the
// employer, the vacancy and the job offer to the applicant's case.

const opt = (max = 200) => z.string().trim().max(max).optional().transform((v) => v || null);
const num = z.string().trim().optional().transform((v, ctx) => {
  if (!v) return null;
  const n = Number(v.replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) {
    ctx.addIssue({ code: 'custom', message: 'Enter a number' });
    return z.NEVER;
  }
  return n;
});

export const organizationInput = z.object({
  name: z.string().trim().min(2, 'Name the organisation').max(160),
  country: z.string().trim().regex(/^[A-Z]{2}$/).optional().or(z.literal('').transform(() => undefined)),
  city: opt(80),
  industry: opt(80),
  contactName: opt(120),
  email: z.string().trim().max(200).optional().transform((v) => v || undefined).pipe(z.email('Enter a valid email').optional()),
  phone: opt(40),
  website: opt(200),
  sponsorLicence: opt(120),
  notes: opt(4000),
});

const orgData = (i: z.output<typeof organizationInput>) => ({
  name: i.name,
  country: i.country ?? null,
  city: i.city,
  industry: i.industry,
  notes: i.notes,
  contact: { name: i.contactName, email: i.email ?? null, phone: i.phone, website: i.website },
  data: { sponsorLicence: i.sponsorLicence },
});

export async function createOrganization(scope: Scope, raw: unknown) {
  const input = organizationInput.parse(raw);
  return inTenant(scope, (tx) => tx.organization.create({ data: { tenantId: scope.tenantId, ...orgData(input) } }));
}

export async function updateOrganization(scope: Scope, id: string, raw: unknown) {
  const input = organizationInput.parse(raw);
  return inTenant(scope, async (tx) => {
    if (!(await tx.organization.findUnique({ where: { id } }))) throw new UserError('Not found');
    return tx.organization.update({ where: { id }, data: orgData(input) });
  });
}

export async function setOrganizationActive(scope: Scope, id: string, active: boolean) {
  return inTenant(scope, (tx) => tx.organization.update({ where: { id }, data: { active } }));
}

export const OPENING_STATUSES = ['open', 'on_hold', 'filled', 'closed'] as const;

export const openingInput = z.object({
  title: z.string().trim().min(2, 'Name the role').max(160),
  occupation: opt(80),
  country: z.string().trim().regex(/^[A-Z]{2}$/).optional().or(z.literal('').transform(() => undefined)),
  productId: opt(40),
  positions: num,
  salaryMin: num,
  salaryMax: num,
  currency: opt(3),
  minExperience: num,
  licences: z.string().trim().max(200).optional().transform((v) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : [])),
  qualification: opt(60),
  description: opt(4000),
  closesAt: z.string().optional().transform((v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T23:59:59Z`) : null)),
  status: z.enum(OPENING_STATUSES).default('open'),
});

async function openingData(tx: Tx, scope: Scope, i: z.output<typeof openingInput>) {
  if (i.productId && !(await tx.visaProduct.findUnique({ where: { id: i.productId } }))) throw new UserError('Unknown workflow', 'productId');
  if (i.salaryMin != null && i.salaryMax != null && i.salaryMax < i.salaryMin) throw new UserError('Maximum is below minimum', 'salaryMax');
  return {
    title: i.title,
    status: i.status,
    closesAt: i.closesAt,
    data: {
      occupation: i.occupation, country: i.country ?? null, productId: i.productId, positions: i.positions,
      salaryMin: i.salaryMin, salaryMax: i.salaryMax, currency: i.currency?.toUpperCase() ?? null,
      minExperience: i.minExperience, licences: i.licences, qualification: i.qualification, description: i.description,
    } as Prisma.InputJsonValue,
  };
}

export async function createOpening(scope: Scope, organizationId: string, raw: unknown) {
  const input = openingInput.parse(raw);
  return inTenant(scope, async (tx) => {
    if (!(await tx.organization.findUnique({ where: { id: organizationId } }))) throw new UserError('Organisation not found');
    return tx.opening.create({ data: { tenantId: scope.tenantId, organizationId, ...(await openingData(tx, scope, input)) } });
  });
}

export async function updateOpening(scope: Scope, id: string, raw: unknown) {
  const input = openingInput.parse(raw);
  return inTenant(scope, async (tx) => {
    if (!(await tx.opening.findUnique({ where: { id } }))) throw new UserError('Not found');
    return tx.opening.update({ where: { id }, data: await openingData(tx, scope, input) });
  });
}

export type OpeningData = { occupation?: string | null; country?: string | null; productId?: string | null; positions?: number | null; salaryMin?: number | null; salaryMax?: number | null; currency?: string | null; minExperience?: number | null; licences?: string[]; qualification?: string | null; description?: string | null };

/** Occupation → group, from the library and the agency's own list. */
async function occupationGroups(scope: Scope) {
  const { pack } = await tenantPack(scope);
  const lib = await libraryList(pack.id, 'occupation');
  const own = await inTenant(scope, (tx) => tx.tenantLibraryItem.findMany({ where: { packId: pack.id, type: 'occupation' } }));
  return new Map<string, string | undefined>([...lib.map((o) => [o.key, o.group] as const), ...own.map((o) => [o.key, (o.data as { group?: string }).group] as const)]);
}

/** Which occupation groups the opening's route admits, from its library pathway. */
async function routeEligibility(scope: Scope, productId: string | null | undefined): Promise<Eligibility> {
  if (!productId) return [];
  const p = await inTenant(scope, (tx) => tx.visaProduct.findUnique({ where: { id: productId }, select: { libraryKey: true, packId: true } }));
  if (!p?.libraryKey || !p.packId) return [];
  const { pack } = await tenantPack(scope);
  const item = await prisma.libraryItem.findUnique({ where: { packId_type_key: { packId: p.packId, type: pack.workflowType, key: p.libraryKey } } });
  return ((item?.data as { occupations?: Eligibility })?.occupations ?? []).filter((e) => e?.group && e?.eligibility);
}

const profileOf = (packData: PackValues, groups: Map<string, string | undefined>): CandidateProfile => ({
  occupation: (packData.occupation as string) ?? null,
  occupationGroup: groups.get(packData.occupation as string) ?? null,
  experienceYears: (packData.experienceYears as number) ?? null,
  licences: (packData.licences as CandidateProfile['licences']) ?? [],
  preferredCountries: [...((packData.preferredCountries as string[]) ?? []), ...((packData.alsoInterested as string[]) ?? [])],
  qualification: (packData.qualification as string) ?? null,
});

/** Clients who fit an opening best, excluding those already in its pipeline. */
export async function suggestCandidates(scope: Scope, openingId: string, take = 15) {
  const opening = await inTenant(scope, (tx) => tx.opening.findUnique({ where: { id: openingId }, include: { candidates: { select: { clientId: true } } } }));
  if (!opening) throw new UserError('Not found');
  const d = opening.data as OpeningData;
  const [groups, eligibility] = await Promise.all([occupationGroups(scope), routeEligibility(scope, d.productId)]);
  const needs: OpeningNeeds = { ...d, occupationGroup: d.occupation ? (groups.get(d.occupation) ?? null) : null };
  const taken = new Set(opening.candidates.map((c) => c.clientId));
  const clients = await inTenant(scope, (tx) =>
    tx.client.findMany({ select: { id: true, ref: true, firstName: true, lastName: true, packData: true }, orderBy: { updatedAt: 'desc' }, take: 2000 }),
  );
  return clients
    .filter((c) => !taken.has(c.id))
    .map((c) => ({ client: c, match: matchCandidate(needs, profileOf(c.packData as PackValues, groups), eligibility) }))
    .filter((x) => !x.match.excluded && x.match.score >= 35)
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, take);
}

export const CANDIDATE_STAGES = ['shortlisted', 'submitted', 'interview', 'offered', 'hired', 'rejected'] as const;
export type CandidateStage = (typeof CANDIDATE_STAGES)[number];

export async function addCandidate(scope: Scope, openingId: string, clientId: string) {
  const opening = await inTenant(scope, (tx) => tx.opening.findUnique({ where: { id: openingId } }));
  if (!opening) throw new UserError('Not found');
  const d = opening.data as OpeningData;
  const [groups, eligibility] = await Promise.all([occupationGroups(scope), routeEligibility(scope, d.productId)]);
  return inTenant(scope, async (tx) => {
    const client = await tx.client.findUnique({ where: { id: clientId } });
    if (!client) throw new UserError('Client not found');
    const m = matchCandidate({ ...d, occupationGroup: d.occupation ? (groups.get(d.occupation) ?? null) : null }, profileOf(client.packData as PackValues, groups), eligibility);
    if (m.excluded) throw new UserError(m.excluded);
    if (await tx.openingCandidate.findUnique({ where: { openingId_clientId: { openingId, clientId } } })) throw new UserError('Already shortlisted');
    const c = await tx.openingCandidate.create({ data: { tenantId: scope.tenantId, openingId, clientId, score: m.score } });
    await logActivity(tx, scope, { type: 'SHORTLISTED', summary: `Shortlisted for ${opening.title}`, clientId, data: { openingId } });
    return c;
  });
}

/**
 * Move a candidate through the pipeline. Hiring links the employer, vacancy and offer to
 * the client's open case for the vacancy's workflow, opening one if there isn't one.
 */
export async function setCandidateStage(scope: Scope, candidateId: string, stage: CandidateStage, opts: { interviewAt?: Date | null; notes?: string | null } = {}) {
  const res = await setCandidateStageTx(scope, candidateId, stage, opts);
  const { emit } = await import('./rules');
  await emit(scope, 'CANDIDATE_STAGE', { recordType: 'candidate', recordId: candidateId, clientId: res.clientId, caseId: res.caseId, ownerId: res.ownerId, values: { status: stage }, words: { name: res.name, stage, title: res.title } });
  if (res.openedCase) {
    const { emitCaseOpened } = await import('./cases');
    await emitCaseOpened(scope, res.caseId!);
  }
  return { caseId: res.caseId };
}

function setCandidateStageTx(scope: Scope, candidateId: string, stage: CandidateStage, opts: { interviewAt?: Date | null; notes?: string | null }) {
  if (!CANDIDATE_STAGES.includes(stage)) throw new UserError('Unknown stage');
  return inTenant(scope, async (tx) => {
    const cand = await tx.openingCandidate.findUnique({ where: { id: candidateId }, include: { opening: { include: { organization: true } }, client: true } });
    if (!cand) throw new UserError('Not found');
    await tx.openingCandidate.update({
      where: { id: candidateId },
      data: { stage, ...(opts.interviewAt !== undefined ? { interviewAt: opts.interviewAt } : {}), ...(opts.notes !== undefined ? { notes: opts.notes } : {}) },
    });
    const { opening } = cand;
    const d = opening.data as OpeningData;
    await logActivity(tx, scope, { type: 'CANDIDATE_STAGE', summary: `${opening.title} at ${opening.organization.name}: ${stage}`, clientId: cand.clientId, data: { openingId: opening.id, stage } });
    const base = { clientId: cand.clientId, ownerId: cand.client.ownerId, name: [cand.client.firstName, cand.client.lastName].filter(Boolean).join(' '), title: opening.title };
    if (stage !== 'hired') return { ...base, caseId: null as string | null, openedCase: false };
    const offer = { title: opening.title, employer: opening.organization.name, salaryMin: d.salaryMin, salaryMax: d.salaryMax, currency: d.currency, at: new Date().toISOString() };
    let c = await tx.case.findFirst({ where: { clientId: cand.clientId, status: { not: 'CLOSED' }, ...(d.productId ? { productId: d.productId } : {}) }, orderBy: { createdAt: 'desc' } });
    const openedCase = !c && !!d.productId;
    if (!c && d.productId) c = await openCaseTx(tx, scope, { clientId: cand.clientId, productId: d.productId });
    if (c) {
      await tx.case.update({ where: { id: c.id }, data: { organizationId: opening.organizationId, openingId: opening.id, jobOffer: offer as Prisma.InputJsonValue } });
      await logActivity(tx, scope, { type: 'JOB_OFFER', summary: `Job offer: ${opening.title} at ${opening.organization.name}`, caseId: c.id, clientId: cand.clientId });
    }
    const hired = await tx.openingCandidate.count({ where: { openingId: opening.id, stage: 'hired' } });
    if (d.positions && hired >= d.positions) await tx.opening.update({ where: { id: opening.id }, data: { status: 'filled' } });
    return { ...base, caseId: c?.id ?? null, openedCase };
  });
}

export async function removeCandidate(scope: Scope, candidateId: string) {
  return inTenant(scope, (tx) => tx.openingCandidate.deleteMany({ where: { id: candidateId } }));
}
