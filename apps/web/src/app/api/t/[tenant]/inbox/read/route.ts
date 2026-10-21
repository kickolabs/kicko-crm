import { NextResponse } from 'next/server';
import { getCtx } from '@/lib/tenant';
import { markThreadRead, parseContactKey } from '@/server/messages';
import { scopeOf } from '@/server/scope';

// Marks a conversation read when it's opened. A plain request rather than a server
// action: an automatic action fired during navigation could jam Next's action queue
// and leave the user's next click (e.g. "Resume AI") stuck pending.
export async function POST(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  if (!req.headers.get('content-type')?.includes('application/json')) return NextResponse.json({ error: 'JSON only' }, { status: 415 });
  const ctx = await getCtx(tenant);
  const { key } = (await req.json().catch(() => ({}))) as { key?: string };
  const contact = key ? parseContactKey(key) : null;
  if (!contact) return NextResponse.json({ error: 'Unknown conversation' }, { status: 400 });
  await markThreadRead(scopeOf(ctx), contact);
  return NextResponse.json({ ok: true });
}
