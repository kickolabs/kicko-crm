import 'server-only';
import type { LeadSource } from '@kicko/db';
import { normalizePhone } from '@/lib/phone';
import { createLead } from './leads';
import { inTenant, type Scope } from './scope';

export type Contact = { kind: 'client' | 'lead'; id: string };

/** Find the client (preferred) or open lead for a number, or create a new lead. Used by WhatsApp and calls. */
export async function findOrCreateByPhone(scope: Scope, rawPhone: string, source: LeadSource, name?: string): Promise<Contact> {
  const phone = normalizePhone(rawPhone.startsWith('+') ? rawPhone : `+${rawPhone.replace(/\D/g, '')}`, scope.country)!;
  const found = await findByPhone(scope, phone);
  if (found) return found;
  const [first, ...rest] = (name?.trim() || (source === 'CALL' ? 'Caller' : 'WhatsApp contact')).split(/\s+/);
  const res = await createLead(scope, { firstName: first!, lastName: rest.join(' ') || undefined, phone, source }, { mergeDuplicates: true });
  if (res.status === 'created') return { kind: 'lead', id: res.leadId };
  if (res.status === 'merged' && res.clientId) return { kind: 'client', id: res.clientId };
  if (res.status === 'merged' && res.leadId) return { kind: 'lead', id: res.leadId };
  throw new Error('Could not resolve contact');
}

export function findByPhone(scope: Scope, phone: string) {
  return inTenant(scope, async (tx): Promise<Contact | null> => {
    const client = await tx.client.findFirst({ where: { phoneNormalized: phone }, orderBy: { createdAt: 'asc' } });
    if (client) return { kind: 'client', id: client.id };
    const lead = await tx.lead.findFirst({ where: { phoneNormalized: phone, clientId: null }, orderBy: { createdAt: 'desc' } });
    return lead ? { kind: 'lead', id: lead.id } : null;
  });
}
