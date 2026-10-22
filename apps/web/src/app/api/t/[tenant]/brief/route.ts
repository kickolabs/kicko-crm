import { NextResponse } from 'next/server';
import { getCtx } from '@/lib/tenant';
import { getBrief } from '@/server/copilot';

// Kicko Yu's daily brief, fetched by the dashboard after it renders. A plain request,
// not part of the page stream, so it never holds up (or races) actions on the page.
export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await getCtx((await params).tenant);
  const brief = await getBrief(ctx);
  return brief ? NextResponse.json(brief, { headers: { 'cache-control': 'private, no-store' } }) : new NextResponse(null, { status: 204 });
}
