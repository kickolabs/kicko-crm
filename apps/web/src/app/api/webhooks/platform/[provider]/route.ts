import { NextResponse, type NextRequest } from 'next/server';
import { platformBilling } from '@/integrations/core/platform';
import { processBillingEvents } from '@/server/plan';

// Kicko's own subscription billing (agencies paying Kicko):
//   https://app.kicko.app/api/webhooks/platform/razorpay
// Events: subscription.activated/charged/halted/pending/cancelled, payment_link.paid.
export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const billing = platformBilling();
  if ((await params).provider !== billing.id) return new NextResponse(null, { status: 404 });
  const raw = await req.text();
  let events;
  try {
    events = billing.parseWebhook(raw, req.headers);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (events === null) return new NextResponse('Invalid signature', { status: 401 });
  try {
    await processBillingEvents(events);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('platform billing webhook', err);
    return NextResponse.json({ ok: false }, { status: 500 }); // retried; processing is idempotent
  }
}
