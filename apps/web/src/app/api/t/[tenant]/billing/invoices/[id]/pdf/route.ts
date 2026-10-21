import { NextResponse } from 'next/server';
import { getCtx } from '@/lib/tenant';
import { invoicePdf } from '@/server/billing-pdf';

export async function GET(_: Request, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params;
  const pdf = await invoicePdf(await getCtx(tenant), id);
  if (!pdf) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return new NextResponse(new Uint8Array(pdf.bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${pdf.fileName}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
