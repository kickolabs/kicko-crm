import { NextResponse, type NextRequest } from 'next/server';
import { getCtx } from '@/lib/tenant';
import { search } from '@/server/queries';

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await getCtx((await params).tenant);
  const q = req.nextUrl.searchParams.get('q') ?? '';
  return NextResponse.json(await search(ctx, q.slice(0, 80)));
}
