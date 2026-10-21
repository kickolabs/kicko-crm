import 'server-only';
import { withTenant } from '@kicko/db';
import type { TenantSettings } from '@kicko/db/provision';
import { fullName } from '@/lib/format';
import { can } from '@/lib/permissions';
import type { Ctx } from '@/lib/tenant';
import { renderInvoicePdf, renderReceiptPdf, type PdfAgency } from './pdf';
import type { PortalCtx } from './portal-auth';

type Owner = { tenantId: string; tz: string; agency: PdfAgency; clientId?: string };

const agencyOf = (name: string, settings: TenantSettings): PdfAgency => ({ name, ...(settings.billing ?? {}) });

const fromCtx = (ctx: Ctx): Owner => ({ tenantId: ctx.tenant.id, tz: ctx.tenant.timezone, agency: agencyOf(ctx.tenant.name, ctx.tenant.settings) });
const fromPortal = (p: PortalCtx): Owner => ({ tenantId: p.scope.tenantId, tz: p.scope.timezone, agency: agencyOf(p.tenantName, p.scope.settings), clientId: p.client.id });

async function invoicePdfFor(o: Owner, invoiceId: string) {
  const inv = await withTenant(o.tenantId, (tx) =>
    tx.invoice.findFirst({
      // Portal callers are pinned to their own client and never see drafts or voids.
      where: { id: invoiceId, ...(o.clientId ? { clientId: o.clientId, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] } } : {}) },
      include: { client: true, case: true, items: { orderBy: { sortOrder: 'asc' } }, installments: { orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }] } },
    }),
  );
  if (!inv) return null;
  const bytes = await renderInvoicePdf({
    tz: o.tz,
    agency: o.agency,
    client: { name: fullName(inv.client), ref: inv.client.ref, address: inv.client.address, phone: inv.client.phone, email: inv.client.email },
    invoice: { ...inv, caseRef: inv.case?.ref },
  });
  return { bytes, fileName: `${inv.ref.replace(/\//g, '-')}.pdf` };
}

async function receiptPdfFor(o: Owner, paymentId: string) {
  const p = await withTenant(o.tenantId, (tx) =>
    tx.payment.findFirst({ where: { id: paymentId, ...(o.clientId ? { clientId: o.clientId } : {}) }, include: { client: true, invoice: true } }),
  );
  if (!p) return null;
  // Balance as it stood right after this payment.
  const paidToDate = await withTenant(o.tenantId, async (tx) =>
    (await tx.payment.aggregate({ where: { invoiceId: p.invoiceId, paidAt: { lte: p.paidAt }, createdAt: { lte: p.createdAt } }, _sum: { amount: true } }))._sum.amount ?? 0,
  );
  const bytes = await renderReceiptPdf({
    tz: o.tz,
    agency: o.agency,
    client: { name: fullName(p.client), ref: p.client.ref, address: p.client.address, phone: p.client.phone, email: p.client.email },
    payment: p,
    invoice: { ref: p.invoice.ref, total: p.invoice.total, amountPaid: paidToDate, currency: p.invoice.currency },
  });
  return { bytes, fileName: `${p.receiptRef.replace(/\//g, '-')}.pdf` };
}

export const invoicePdf = (ctx: Ctx, id: string) => (can(ctx.role, 'billing.read') ? invoicePdfFor(fromCtx(ctx), id) : null);
export const receiptPdf = (ctx: Ctx, id: string) => (can(ctx.role, 'billing.read') ? receiptPdfFor(fromCtx(ctx), id) : null);
export const portalInvoicePdf = (p: PortalCtx, id: string) => invoicePdfFor(fromPortal(p), id);
export const portalReceiptPdf = (p: PortalCtx, id: string) => receiptPdfFor(fromPortal(p), id);
