import 'server-only';
import type { Prisma } from '@kicko/db';
import type { TenantSettings } from '@kicko/db/provision';
import { llmFor } from '@/integrations/core/platform';
import { fullName } from '@/lib/format';
import { compareWithProfile, mergeIssues, readDocument, READABLE_TYPES, type DocCheck } from './ai/doc-check';
import { inTenant, logActivity, type Scope } from './scope';
import { getObject } from './storage';
import { consumeCredits, featureOn, NO_CREDITS } from './plan';

// Runs after every upload (staff or client portal). Never throws: a failed check
// must not affect the upload itself.

const MAX_BYTES = 8 * 1024 * 1024;
export const docChecksOn = (s: TenantSettings) => s.ai?.docChecks !== false;

export async function checkDocumentFile(scope: Scope, fileId: string) {
  try {
    if (!docChecksOn(scope.settings)) return;
    if (!(await featureOn(scope.tenantId, 'doc_checks'))) return;
    const file = await inTenant(scope, (tx) => tx.documentFile.findUnique({ where: { id: fileId }, include: { document: { include: { client: true } } } }));
    if (!file) return;
    const doc = file.document;
    const save = (aiStatus: string, aiCheck?: Prisma.InputJsonValue) =>
      inTenant(scope, (tx) => tx.documentFile.update({ where: { id: fileId }, data: { aiStatus, ...(aiCheck ? { aiCheck } : {}) } }));
    await save('pending');

    const model = llmFor('document_check');
    let bytes: Buffer | null = null;
    if (!model.sandbox) {
      if (!READABLE_TYPES.includes(file.contentType) || file.size > MAX_BYTES) {
        return void (await save('skipped', { reason: `Can't read ${file.contentType === 'image/heic' ? 'HEIC photos' : 'this file type or size'} automatically.` }));
      }
      bytes = await getObject(file.storageKey);
    }
    if (!(await consumeCredits(scope.tenantId, 'doc_check', { fileId }))) return void (await save('skipped', { reason: NO_CREDITS }));
    const read = await readDocument(scope.tenantId, { bytes, mime: file.contentType, fileName: file.fileName, size: file.size }, { name: doc.name, group: doc.group });
    const issues = mergeIssues(
      read.data.issues,
      compareWithProfile(read.data, { name: doc.name }, { fullName: fullName(doc.client), dob: doc.client.dob, passportNumber: doc.client.passportNumber }),
    );
    const check: DocCheck = { ...read.data, issues, model: read.model, sandbox: read.sandbox, checkedAt: new Date().toISOString() };
    await inTenant(scope, async (tx) => {
      await tx.documentFile.update({ where: { id: fileId }, data: { aiStatus: 'done', aiCheck: check } });
      const high = issues.filter((i) => i.severity === 'high');
      if (high.length) {
        await logActivity(tx, { ...scope, actorId: null }, { type: 'DOC_AI_CHECK', summary: `AI check on ${doc.name}: ${high[0]!.message}${high.length > 1 ? ` (+${high.length - 1} more)` : ''}`, caseId: doc.caseId, clientId: doc.clientId });
      }
    });
  } catch (err) {
    console.error('doc check', fileId, err);
    await inTenant(scope, (tx) => tx.documentFile.update({ where: { id: fileId }, data: { aiStatus: 'failed', aiCheck: { reason: err instanceof Error ? err.message.slice(0, 200) : 'Check failed' } } })).catch(() => {});
  }
}
