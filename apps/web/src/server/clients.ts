import 'server-only';
import { z } from 'zod';
import { normalizeEmail, normalizePhone } from '@/lib/phone';
import { parseLocal } from '@/lib/format';
import { inTenant, logActivity, UserError, type Scope } from './scope';
import { findDuplicates } from './leads';

const opt = z
  .string()
  .trim()
  .max(300)
  .optional()
  .transform((v) => (v ? v : null));

export const clientProfileInput = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  lastName: opt,
  email: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(z.email('Enter a valid email').nullable()),
  phone: opt,
  dob: opt,
  gender: opt,
  nationality: opt,
  passportNumber: opt,
  passportExpiry: opt,
  maritalStatus: opt,
  address: opt,
  ownerId: opt,
});

const scoreLike = z.string().trim().max(20).optional().default('');

export const testsInput = z.array(
  z.object({
    test: z.string().trim().min(1).max(20),
    overall: scoreLike,
    l: scoreLike,
    r: scoreLike,
    w: scoreLike,
    s: scoreLike,
    date: z.string().trim().max(10).optional().default(''),
  }),
);

export const educationInput = z.array(
  z.object({
    level: z.string().trim().min(1).max(60),
    institution: z.string().trim().max(160).optional().default(''),
    field: z.string().trim().max(120).optional().default(''),
    year: z.string().trim().max(10).optional().default(''),
    score: z.string().trim().max(30).optional().default(''),
  }),
);

export const workInput = z.array(
  z.object({
    employer: z.string().trim().min(1).max(160),
    title: z.string().trim().max(120).optional().default(''),
    from: z.string().trim().max(10).optional().default(''),
    to: z.string().trim().max(10).optional().default(''),
    code: z.string().trim().max(20).optional().default(''), // ANZSCO / NOC
  }),
);

export async function updateClientProfile(scope: Scope, clientId: string, raw: unknown) {
  const input = clientProfileInput.parse(raw);
  const phoneNormalized = normalizePhone(input.phone, scope.country);
  const email = normalizeEmail(input.email);
  return inTenant(scope, async (tx) => {
    const client = await tx.client.findUnique({ where: { id: clientId } });
    if (!client) throw new UserError('Client not found');
    const dups = (await findDuplicates(tx, phoneNormalized, email)).filter((d) => !(d.kind === 'client' && d.id === clientId));
    const clientDup = dups.find((d) => d.kind === 'client');
    if (clientDup) throw new UserError(`Another client (${clientDup.ref} ${clientDup.name}) has the same ${clientDup.matchedOn}`);
    await tx.client.update({
      where: { id: clientId },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email,
        phone: input.phone,
        phoneNormalized,
        dob: parseLocal(input.dob, 'UTC'),
        gender: input.gender,
        nationality: input.nationality,
        passportNumber: input.passportNumber?.toUpperCase() ?? null,
        passportExpiry: parseLocal(input.passportExpiry, 'UTC'),
        maritalStatus: input.maritalStatus,
        address: input.address,
        ownerId: input.ownerId,
      },
    });
    await logActivity(tx, scope, { type: 'PROFILE_UPDATED', summary: 'Profile updated', clientId });
  });
}

export async function updateClientJson(
  scope: Scope,
  clientId: string,
  field: 'tests' | 'education' | 'work',
  value: unknown,
) {
  const schema = field === 'tests' ? testsInput : field === 'education' ? educationInput : workInput;
  const parsed = schema.parse(value);
  return inTenant(scope, async (tx) => {
    const res = await tx.client.updateMany({ where: { id: clientId }, data: { [field]: parsed } });
    if (!res.count) throw new UserError('Client not found');
  });
}

export const familyInput = z.object({
  relation: z.enum(['SPOUSE', 'CHILD', 'PARENT', 'SIBLING']),
  name: z.string().trim().min(1, 'Name is required').max(120),
  dob: opt,
  passportNumber: opt,
  included: z.boolean().default(true),
});

export async function addFamilyMember(scope: Scope, clientId: string, raw: unknown) {
  const input = familyInput.parse(raw);
  return inTenant(scope, async (tx) => {
    const client = await tx.client.findUnique({ where: { id: clientId } });
    if (!client) throw new UserError('Client not found');
    await tx.familyMember.create({
      data: {
        tenantId: scope.tenantId,
        clientId,
        relation: input.relation,
        name: input.name,
        dob: parseLocal(input.dob, 'UTC'),
        passportNumber: input.passportNumber?.toUpperCase() ?? null,
        included: input.included,
      },
    });
    await logActivity(tx, scope, { type: 'FAMILY_ADDED', summary: `${input.relation.toLowerCase()} added: ${input.name}`, clientId });
  });
}

export async function removeFamilyMember(scope: Scope, memberId: string) {
  return inTenant(scope, async (tx) => {
    await tx.familyMember.deleteMany({ where: { id: memberId } });
  });
}
