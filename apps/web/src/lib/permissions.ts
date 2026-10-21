import type { Role } from '@kicko/db';

export type Permission =
  | 'settings.manage'
  | 'team.manage'
  | 'lead.write'
  | 'client.write'
  | 'case.write'
  | 'task.write'
  | 'checkin.write'
  | 'document.write' // upload, request, mark N/A
  | 'document.verify' // verify / reject
  | 'billing.read'
  | 'billing.write' // invoices, payments, payment links
  | 'partners.manage' // institutions, courses, agreements
  | 'application.write' // study applications on cases
  | 'commission.manage'; // claims & reconciliation

const ALL: Permission[] = [
  'settings.manage', 'team.manage', 'lead.write', 'client.write', 'case.write', 'task.write', 'checkin.write',
  'document.write', 'document.verify', 'billing.read', 'billing.write', 'partners.manage', 'application.write',
  'commission.manage',
];

const MATRIX: Record<Role, Permission[]> = {
  OWNER: ALL,
  ADMIN: ALL,
  COUNSELLOR: [
    'lead.write', 'client.write', 'case.write', 'task.write', 'checkin.write', 'document.write', 'billing.read',
    'application.write',
  ],
  DOC_OFFICER: ['client.write', 'case.write', 'task.write', 'checkin.write', 'document.write', 'document.verify', 'application.write'],
  ACCOUNTS: ['task.write', 'checkin.write', 'billing.read', 'billing.write', 'commission.manage'],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  COUNSELLOR: 'Counsellor',
  DOC_OFFICER: 'Document officer',
  ACCOUNTS: 'Accounts',
};
