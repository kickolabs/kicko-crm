import { NextResponse, type NextRequest } from 'next/server';
import { ALLOWED_TYPES, MEDIA_EXT, readLocal, storageDriver, verifyToken } from '@/server/storage';

const TYPE_BY_EXT = Object.fromEntries(Object.entries({ ...ALLOWED_TYPES, ...MEDIA_EXT }).map(([ct, ext]) => [ext, ct]));

// Local-driver download. Links are minted only after an RLS-checked lookup and expire in 5 minutes.
export async function GET(req: NextRequest) {
  if (storageDriver !== 'local') return new NextResponse(null, { status: 404 });
  const t = verifyToken(req.nextUrl.searchParams.get('t'), 'get');
  if (!t) return NextResponse.json({ error: 'Link expired' }, { status: 403 });
  try {
    const data = await readLocal(t.k);
    const ext = t.k.split('.').pop() ?? '';
    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': TYPE_BY_EXT[ext] ?? 'application/octet-stream',
        'Content-Disposition': `${t.inl ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(t.n ?? 'file')}`,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'",
      },
    });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
