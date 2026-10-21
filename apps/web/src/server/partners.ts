import 'server-only';
import type { ApplicationStatus, ClaimStatus, Tx } from '@kicko/db';
import { z } from 'zod';
import { parseLocal } from '@/lib/format';
import { bp, formatMoney, parseMoney } from '@/lib/money';
import { inTenant, logActivity, UserError, type Scope } from './scope';

const optStr = (max = 200) => z.string().trim().max(max).optional().transform((v) => v || null);
const optMoney = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const m = parseMoney(v);
    if (m == null || m < 0) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid amount' });
      return z.NEVER;
    }
    return m;
  });

// ── Institutions ────────────────────────────────────────────────────────────

export const institutionInput = z
  .object({
    name: z.string().trim().min(2, 'Name is required').max(160),
    country: z.string().trim().length(2, 'Pick a country'),
    city: optStr(80),
    kind: z.enum(['UNIVERSITY', 'COLLEGE', 'SCHOOL', 'AGGREGATOR']),
    website: optStr(200),
    contactEmail: z.string().trim().optional().transform((v) => v || null).pipe(z.email('Enter a valid email').nullable()),
    currency: z.string().trim().length(3),
    commissionType: z.enum(['PERCENT', 'FLAT']),
    commissionValue: z.string().min(1, 'Enter the commission'),
    commissionBasis: z.string().trim().max(120).default('First-year tuition'),
    agreementUntil: optStr(10),
    notes: optStr(2000),
    active: z.boolean().default(true),
  })
  .transform((v, ctx) => {
    const value = v.commissionType === 'PERCENT' ? Math.round(Number(v.commissionValue) * 100) : parseMoney(v.commissionValue);
    if (value == null || !Number.isFinite(value) || value < 0 || (v.commissionType === 'PERCENT' && value > 10_000)) {
      ctx.addIssue({ code: 'custom', path: ['commissionValue'], message: 'Enter a valid commission' });
      return z.NEVER;
    }
    return { ...v, commissionValue: value, agreementUntil: parseLocal(v.agreementUntil, 'UTC') };
  });

export async function saveInstitution(scope: Scope, id: string | null, raw: unknown) {
  const data = institutionInput.parse(raw);
  return inTenant(scope, async (tx) => {
    if (id) {
      const res = await tx.institution.updateMany({ where: { id }, data });
      if (!res.count) throw new UserError('Institution not found');
      return id;
    }
    return (await tx.institution.create({ data: { tenantId: scope.tenantId, ...data } })).id;
  });
}

export const courseInput = z.object({
  name: z.string().trim().min(2, 'Course name is required').max(200),
  level: optStr(60),
  durationMonths: z.coerce.number().int().min(1).max(120).optional().or(z.literal('').transform(() => undefined)),
  tuitionFee: optMoney,
  intakes: optStr(80),
});

export async function addCourse(scope: Scope, institutionId: string, raw: unknown) {
  const input = courseInput.parse(raw);
  return inTenant(scope, async (tx) => {
    const inst = await tx.institution.findUnique({ where: { id: institutionId } });
    if (!inst) throw new UserError('Institution not found');
    await tx.course.create({ data: { tenantId: scope.tenantId, institutionId, ...input, durationMonths: input.durationMonths ?? null } });
  });
}

export async function removeCourse(scope: Scope, courseId: string) {
  return inTenant(scope, async (tx) => {
    const used = await tx.application.count({ where: { courseId } });
    if (used) await tx.course.updateMany({ where: { id: courseId }, data: { active: false } });
    else await tx.course.deleteMany({ where: { id: courseId } });
  });
}

// ── Applications ────────────────────────────────────────────────────────────

export const applicationInput = z.object({
  institutionId: z.string().min(1, 'Choose an institution'),
  courseId: z.string().optional().transform((v) => v || null),
  courseName: optStr(200),
  intake: optStr(40),
  tuitionFee: optMoney,
  studentId: optStr(60),
});

export async function addApplication(scope: Scope, caseId: string, raw: unknown) {
  const input = applicationInput.parse(raw);
  return inTenant(scope, async (tx) => {
    const c = await tx.case.findUnique({ where: { id: caseId } });
    if (!c) throw new UserError('Case not found');
    const inst = await tx.institution.findUnique({ where: { id: input.institutionId } });
    if (!inst) throw new UserError('Institution not found');
    const course = input.courseId ? await tx.course.findUnique({ where: { id: input.courseId } }) : null;
    if (input.courseId && (!course || course.institutionId !== inst.id)) throw new UserError('That course belongs to another institution');
    if (!course && !input.courseName) throw new UserError('Pick a course or type its name');
    await tx.application.create({
      data: {
        tenantId: scope.tenantId,
        caseId,
        institutionId: inst.id,
        courseId: course?.id ?? null,
        courseName: course ? null : input.courseName,
        intake: input.intake,
        tuitionFee: input.tuitionFee ?? course?.tuitionFee ?? null,
        currency: inst.currency,
        studentId: input.studentId,
      },
    });
    await logActivity(tx, scope, {
      type: 'APPLICATION',
      summary: `Application added: ${inst.name} · ${course?.name ?? input.courseName}`,
      caseId,
      clientId: c.clientId,
    });
  });
}

export const APPLICATION_LABEL: Record<ApplicationStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  CONDITIONAL_OFFER: 'Conditional offer',
  UNCONDITIONAL_OFFER: 'Unconditional offer',
  REJECTED: 'Rejected',
  ACCEPTED: 'Offer accepted',
  ENROLLED: 'Enrolled',
  WITHDRAWN: 'Withdrawn',
};

/** Expected commission from the institution agreement. */
export function expectedCommission(inst: { commissionType: string; commissionValue: number }, tuitionFee: number | null) {
  if (inst.commissionType === 'FLAT') return inst.commissionValue;
  return tuitionFee ? bp(tuitionFee, inst.commissionValue) : 0;
}

async function ensureClaim(tx: Tx, scope: Scope, applicationId: string) {
  const app = await tx.application.findUnique({ where: { id: applicationId }, include: { institution: true, claims: true } });
  if (!app || app.claims.length) return null;
  const amount = expectedCommission(app.institution, app.tuitionFee);
  if (!amount) return null;
  return tx.commissionClaim.create({
    data: {
      tenantId: scope.tenantId,
      applicationId: app.id,
      institutionId: app.institutionId,
      amount,
      currency: app.institution.currency,
      dueDate: new Date(Date.now() + 60 * 86400_000), // institutions typically pay after census date
    },
  });
}

export async function setApplicationStatus(scope: Scope, applicationId: string, status: ApplicationStatus) {
  return inTenant(scope, async (tx) => {
    const app = await tx.application.findUnique({ where: { id: applicationId }, include: { institution: true, case: true } });
    if (!app) throw new UserError('Application not found');
    await tx.application.update({
      where: { id: applicationId },
      data: {
        status,
        submittedAt: status === 'SUBMITTED' && !app.submittedAt ? new Date() : app.submittedAt,
        decisionAt: ['CONDITIONAL_OFFER', 'UNCONDITIONAL_OFFER', 'REJECTED'].includes(status) ? new Date() : app.decisionAt,
      },
    });
    let claimNote = '';
    if (status === 'ENROLLED') {
      const claim = await ensureClaim(tx, scope, applicationId);
      if (claim) claimNote = ` · commission ${formatMoney(claim.amount, claim.currency)} expected`;
    }
    await logActivity(tx, scope, {
      type: 'APPLICATION',
      summary: `${app.institution.name}: ${APPLICATION_LABEL[status]}${claimNote}`,
      caseId: app.caseId,
      clientId: app.case.clientId,
    });
  });
}

// ── Commission claims ───────────────────────────────────────────────────────

export const claimUpdateInput = z.object({
  status: z.enum(['EXPECTED', 'CLAIMED', 'RECEIVED', 'WRITTEN_OFF']),
  amount: optMoney,
  invoiceRef: optStr(60),
  receivedAmount: optMoney,
  notes: optStr(1000),
});

export async function updateClaim(scope: Scope, claimId: string, raw: unknown) {
  const input = claimUpdateInput.parse(raw);
  return inTenant(scope, async (tx) => {
    const claim = await tx.commissionClaim.findUnique({ where: { id: claimId } });
    if (!claim) throw new UserError('Claim not found');
    const status = input.status as ClaimStatus;
    if (status === 'RECEIVED' && !(input.receivedAmount ?? claim.receivedAmount)) throw new UserError('Enter the amount received');
    await tx.commissionClaim.update({
      where: { id: claimId },
      data: {
        status,
        amount: input.amount ?? claim.amount,
        invoiceRef: input.invoiceRef ?? claim.invoiceRef,
        notes: input.notes ?? claim.notes,
        claimedAt: status === 'CLAIMED' && !claim.claimedAt ? new Date() : claim.claimedAt,
        receivedAt: status === 'RECEIVED' ? (claim.receivedAt ?? new Date()) : null,
        receivedAmount: status === 'RECEIVED' ? (input.receivedAmount ?? claim.receivedAmount) : null,
      },
    });
  });
}
