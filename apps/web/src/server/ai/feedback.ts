import 'server-only';
import { createHash } from 'node:crypto';
import type { Prisma, Tx } from '@kicko/db';
import type { TenantSettings } from '@kicko/db/provision';
import type { AiTask } from '@/integrations/core/platform';
import type { Scope } from '../scope';

// "Help improve Kicko Yu": when an agency opts in, record what Yu said and what a
// person then did (verified anyway, rejected, took over the chat…). Anonymised
// first; this is the labelled data a fine-tuned Kicko model would learn from.
// Off by default, and turning it off deletes the agency's rows.

export const improveOn = (s: TenantSettings) => s.ai?.improve === true;

/** Strip what identifies a person: names, quoted values, ids, numbers, dates, emails, phones. */
export function scrub(text: string, names: (string | null | undefined)[] = []) {
  // Emails first, so a name inside an address doesn't leave the rest of it behind.
  let out = text.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]');
  for (const n of names.flatMap((v) => (v ?? '').split(/\s+/)).filter((w) => w.length > 1)) {
    out = out.replace(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '[name]');
  }
  return out
    .replace(/"[^"]{1,80}"/g, '"[value]"')
    .replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2} \w{3,9},? \d{4}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, '[date]')
    .replace(/\+?\d[\d\s-]{7,}\d/g, '[phone]')
    .replace(/\b[A-Z]{1,2}\d{6,8}\b/g, '[id]')
    .replace(/\b\d{4,}\b/g, '[number]');
}

/** A stable, non-reversible reference to the source record (to de-duplicate, never to look it up). */
const digest = (id: string) => createHash('sha256').update(`kicko-yu:${id}`).digest('hex').slice(0, 24);

export async function recordFeedback(
  tx: Tx,
  scope: Pick<Scope, 'tenantId' | 'settings'>,
  f: { task: AiTask; subjectId: string; output: Prisma.InputJsonValue; outcome: Prisma.InputJsonValue; agreed: boolean | null },
) {
  if (!improveOn(scope.settings)) return;
  await tx.aiFeedback.create({
    data: { tenantId: scope.tenantId, task: f.task, subject: digest(f.subjectId), output: f.output, outcome: f.outcome, agreed: f.agreed },
  });
}
