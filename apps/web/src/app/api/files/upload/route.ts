import { NextResponse, type NextRequest } from 'next/server';
import { storageDriver, verifyToken, writeLocal } from '@/server/storage';

// Local-driver upload target. In production uploads go straight to R2 via presigned URLs.
export async function PUT(req: NextRequest) {
  if (storageDriver !== 'local') return new NextResponse(null, { status: 404 });
  const t = verifyToken(req.nextUrl.searchParams.get('t'), 'put');
  if (!t) return NextResponse.json({ error: 'Upload link expired' }, { status: 403 });
  if (req.headers.get('content-type') !== t.ct) return NextResponse.json({ error: 'Wrong content type' }, { status: 400 });
  const data = Buffer.from(await req.arrayBuffer());
  if (data.length === 0 || data.length > (t.max ?? 0)) return NextResponse.json({ error: 'Wrong size' }, { status: 400 });
  try {
    await writeLocal(t.k, data);
  } catch {
    return NextResponse.json({ error: 'Already uploaded' }, { status: 409 });
  }
  return new NextResponse(null, { status: 200 });
}
