import { availableSlots } from '@/server/portal';
import { requirePortal } from '@/server/portal-auth';
import { PortalShell } from '../portal-shell';
import { BookingForm } from './booking-form';

export const metadata = { title: 'Book a meeting', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function PortalBook({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await requirePortal(slug);
  const avail = await availableSlots(p);
  return (
    <PortalShell slug={slug} agency={p.tenantName} active="book">
      <section className="card mx-auto w-full max-w-3xl p-6 sm:p-8">
        <h1 className="text-[30px] leading-tight font-extrabold tracking-[-0.04em]">Book a meeting with your consultant</h1>
        {!avail.enabled ? (
          <p className="mt-3 text-muted">Online booking isn't available right now. Please send a message and we'll find a time.</p>
        ) : avail.days.length === 0 ? (
          <p className="mt-3 text-muted">No free slots in the next two weeks. Please send a message and we'll find a time.</p>
        ) : (
          <BookingForm slug={slug} days={avail.days} tz={p.scope.timezone} slotMinutes={avail.slotMinutes} />
        )}
      </section>
    </PortalShell>
  );
}
