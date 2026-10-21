import type { InvoiceStatus } from '@kicko/db';
import { Badge } from '@/components/ui';
import type { Tone } from '@/lib/constants';

const MAP: Record<InvoiceStatus, [string, Tone]> = {
  DRAFT: ['Draft', 'neutral'],
  ISSUED: ['Unpaid', 'warn'],
  PARTIALLY_PAID: ['Part paid', 'info'],
  PAID: ['Paid', 'ok'],
  VOID: ['Void', 'neutral'],
};

export function InvoiceBadge({ status, overdue }: { status: InvoiceStatus; overdue?: boolean }) {
  if (overdue && (status === 'ISSUED' || status === 'PARTIALLY_PAID')) return <Badge tone="danger">Overdue</Badge>;
  const [label, tone] = MAP[status];
  return <Badge tone={tone}>{label}</Badge>;
}
