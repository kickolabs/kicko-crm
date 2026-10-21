import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { runBillingLifecycle } from '@/server/plan';
import { runDailyReminders } from '@/server/reminders';

export const maxDuration = 300;

// Vercel Cron sends "Authorization: Bearer $CRON_SECRET". Locally:
//   curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/daily
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = Buffer.from(req.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Lifecycle first, so reminders and automations see today's subscription state.
  const billing = await runBillingLifecycle();
  return NextResponse.json({ ok: true, billing, created: await runDailyReminders() });
}
