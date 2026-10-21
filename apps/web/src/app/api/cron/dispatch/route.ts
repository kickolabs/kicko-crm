import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { runVoiceDispatch } from '@/server/voice/service';

export const maxDuration = 300;

// Every few minutes: dial queued AI voice calls that are due and inside calling hours.
//   curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/dispatch
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = Buffer.from(req.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ ok: true, started: await runVoiceDispatch() });
}
