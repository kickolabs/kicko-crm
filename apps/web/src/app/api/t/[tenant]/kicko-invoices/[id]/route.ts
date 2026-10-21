import { NextResponse } from 'next/server';
import { withTenant } from '@kicko/db';
import { fmtDate } from '@/lib/format';
import { can } from '@/lib/permissions';
import { getCtx } from '@/lib/tenant';
import { renderPlatformInvoicePdf } from '@/server/pdf';

// Kicko's tax invoice to this workspace (owners/admins).
export async function GET(_: Request, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params;
  const ctx = await getCtx(tenant);
  if (!can(ctx.role, 'settings.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const inv = await withTenant(ctx.tenant.id, (tx) => tx.platformInvoice.findUnique({ where: { id } }));
  if (!inv) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const b = ctx.tenant.settings.billing ?? {};
  const bytes = await renderPlatformInvoicePdf({
    seller: { legalName: process.env.KICKO_LEGAL_NAME ?? 'Kicko', address: process.env.KICKO_ADDRESS ?? '', gstin: process.env.KICKO_GSTIN ?? '' },
    buyer: { name: b.legalName || ctx.tenant.name, address: b.address, gstin: b.gstin },
    invoice: { number: inv.number, date: fmtDate(inv.paidAt, ctx.tenant.timezone), description: inv.description, sac: process.env.KICKO_SAC ?? '998314', subtotal: inv.subtotal, cgst: inv.cgst, sgst: inv.sgst, igst: inv.igst, total: inv.total, currency: inv.currency },
  });
  return new NextResponse(new Uint8Array(bytes), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${inv.number.replace(/\//g, '-')}.pdf"`, 'Cache-Control': 'private, no-store' },
  });
}
