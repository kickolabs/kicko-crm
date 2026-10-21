import { NextResponse } from 'next/server';
import { portalInvoicePdf, portalReceiptPdf } from '@/server/billing-pdf';
import { getPortal } from '@/server/portal-auth';

// Client's own invoices and receipts. The portal cookie is scoped to /portal/{slug}.
export async function GET(_: Request, { params }: { params: Promise<{ slug: string; kind: string; id: string }> }) {
  const { slug, kind, id } = await params;
  const p = await getPortal(slug);
  if (!p) return NextResponse.redirect(new URL(`/portal/${slug}/login`, process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'));
  const pdf = kind === 'invoice' ? await portalInvoicePdf(p, id) : kind === 'receipt' ? await portalReceiptPdf(p, id) : null;
  if (!pdf) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return new NextResponse(new Uint8Array(pdf.bytes), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${pdf.fileName}"`, 'Cache-Control': 'private, no-store' },
  });
}
