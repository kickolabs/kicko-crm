import 'server-only';
import { strToU8, zipSync } from 'fflate';
import { withTenant, type Tx } from '@kicko/db';
import { tableCsv } from '@/lib/reports';
import { audit } from './audit';
import { UserError, type Scope } from './scope';

// "Export all data": every record the agency owns, one CSV per kind, in a ZIP.
// Excludes secrets (integration keys, portal tokens) and internal ids of other
// systems. Works in read-only and suspended workspaces: it's the agency's data.

type Row = Record<string, unknown>;
const TABLES: [file: string, about: string, load: (tx: Tx) => Promise<Row[]>][] = [
  ['leads', 'Enquiries and their status', (tx) => tx.lead.findMany({ orderBy: { createdAt: 'asc' } })],
  ['clients', 'Client profiles (education, tests and work as JSON)', (tx) => tx.client.findMany({ orderBy: { createdAt: 'asc' } })],
  ['family_members', 'Dependants of each client', (tx) => tx.familyMember.findMany()],
  ['cases', 'Visa cases', (tx) => tx.case.findMany({ orderBy: { createdAt: 'asc' } })],
  ['case_stage_history', 'Every stage change of every case', (tx) => tx.stageHistory.findMany()],
  ['visa_products', 'Visa workflows: stages and document checklists', (tx) => tx.visaProduct.findMany()],
  ['tasks', 'Tasks', (tx) => tx.task.findMany()],
  ['appointments', 'Appointments', (tx) => tx.appointment.findMany()],
  ['notes', 'Notes', (tx) => tx.note.findMany()],
  ['activity', 'Timeline of leads, clients and cases', (tx) => tx.activity.findMany({ orderBy: { createdAt: 'asc' } })],
  ['documents', 'Document checklist items per client/case', (tx) => tx.document.findMany()],
  ['document_files', 'Uploaded files (download each from the client’s Documents)', (tx) => tx.documentFile.findMany()],
  ['invoices', 'Invoices', (tx) => tx.invoice.findMany()],
  ['invoice_items', 'Invoice lines', (tx) => tx.invoiceItem.findMany()],
  ['installments', 'Installment plans', (tx) => tx.installment.findMany()],
  ['payments', 'Payments received', (tx) => tx.payment.findMany()],
  ['messages', 'WhatsApp, email and portal messages', (tx) => tx.message.findMany({ orderBy: { createdAt: 'asc' } })],
  ['calls', 'Calls with notes and transcripts', (tx) => tx.call.findMany()],
  ['institutions', 'Partner institutions', (tx) => tx.institution.findMany()],
  ['courses', 'Courses', (tx) => tx.course.findMany()],
  ['applications', 'Study applications', (tx) => tx.application.findMany()],
  ['commission_claims', 'Commission claims', (tx) => tx.commissionClaim.findMany()],
  ['sub_agents', 'Sub-agents', (tx) => tx.subAgent.findMany()],
  ['sub_agent_commissions', 'Sub-agent commissions', (tx) => tx.subAgentCommission.findMany()],
  ['check_ins', 'Walk-in check-ins', (tx) => tx.checkIn.findMany()],
  ['custom_fields', 'Your custom field definitions (values are in each record’s customFields column)', (tx) => tx.customField.findMany()],
  ['team', 'Team members and roles', (tx) => tx.membership.findMany()],
  ['audit_log', 'Audit log', (tx) => tx.auditEvent.findMany({ orderBy: { createdAt: 'asc' } })],
];

// Never exported: internal routing columns and anything secret.
const DROP = new Set(['tenantId', 'storageKey', 'mediaKey', 'recordingKey', 'token', 'tokenHash', 'secret', 'config', 'password']);

const cell = (v: unknown): string | number | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

export function rowsToCsv(rows: Row[]) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((c) => !DROP.has(c));
  return tableCsv(cols, rows.map((r) => cols.map((c) => cell(r[c]))));
}

export async function exportAll(scope: Scope & { tenantName: string }) {
  // One export at a time per agency (it reads everything).
  const recent = await withTenant(scope.tenantId, (tx) =>
    tx.auditEvent.findFirst({ where: { action: 'data.export', createdAt: { gt: new Date(Date.now() - 60_000) } } }),
  );
  if (recent) throw new UserError('An export was just made. Try again in a minute.');

  const files: Record<string, Uint8Array> = {};
  const counts: string[] = [];
  await withTenant(scope.tenantId, async (tx) => {
    for (const [name, about, load] of TABLES) {
      const rows = await load(tx);
      files[`${name}.csv`] = strToU8(`﻿${rowsToCsv(rows)}`); // BOM so Excel reads UTF-8 names correctly
      counts.push(`${name}.csv  ${rows.length} rows  ${about}`);
    }
  }, { readOnly: true });
  const when = new Date().toISOString();
  files['README.txt'] = strToU8(
    `${scope.tenantName}: full data export from Kicko\nCreated ${when}\n\nOne CSV per kind of record. Dates are ISO 8601 (UTC). Amounts are in paise/cents.\nColumns ending in "Id" link records across files (e.g. cases.clientId → clients.id).\nDocument files themselves are not included; download them from each client's Documents.\nIntegration keys, passwords and portal links are never exported.\n\n${counts.join('\n')}\n`,
  );
  const zip = zipSync(files, { level: 6 });
  await audit(scope, 'data.export', 'Exported all agency data (ZIP)', { bytes: zip.length });
  return { zip, fileName: `kicko-${scope.slug}-export-${when.slice(0, 10)}.zip` };
}
