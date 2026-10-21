'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import type { CheckInStatus } from '@kicko/db';
import { ActionButton, ActionForm, FormField, Modal, SubmitButton } from '@/components/forms';
import { Button, Input } from '@/components/ui';
import { setCheckInStatusAction, staffCheckInAction } from '../actions';

/** Keeps the queue fresh while reception has it open. */
export function AutoRefresh({ every = 20_000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), every);
    return () => clearInterval(t);
  }, [router, every]);
  return null;
}

export function QueueActions({ slug, id, status }: { slug: string; id: string; status: CheckInStatus }) {
  if (status === 'WAITING')
    return (
      <span className="flex gap-1.5">
        <ActionButton action={() => setCheckInStatusAction(slug, id, 'WITH_STAFF')} variant="primary">I'll take them</ActionButton>
        <ActionButton action={() => setCheckInStatusAction(slug, id, 'LEFT')} variant="ghost">Left</ActionButton>
      </span>
    );
  if (status === 'WITH_STAFF')
    return <ActionButton action={() => setCheckInStatusAction(slug, id, 'DONE')}>Done</ActionButton>;
  return <span className="text-xs font-semibold text-muted">{status === 'LEFT' ? 'Left without meeting' : 'Seen'}</span>;
}

export function StaffCheckIn({ slug }: { slug: string }) {
  return (
    <Modal title="Add a walk-in" trigger={(open) => <Button variant="primary" onClick={open}><Plus size={15} /> Add walk-in</Button>}>
      {(close) => (
        <ActionForm action={staffCheckInAction.bind(null, slug)} onSuccess={close} className="flex flex-col gap-3.5">
          <FormField label="Name" name="name"><Input name="name" required autoFocus /></FormField>
          <FormField label="Phone" name="phone"><Input name="phone" type="tel" required /></FormField>
          <FormField label="Purpose" name="purpose"><Input name="purpose" placeholder="e.g. Canada study enquiry" required /></FormField>
          <div className="flex justify-end"><SubmitButton>Add to queue</SubmitButton></div>
        </ActionForm>
      )}
    </Modal>
  );
}
