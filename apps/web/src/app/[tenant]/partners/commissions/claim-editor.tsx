'use client';

import { useState } from 'react';
import type { ClaimStatus } from '@kicko/db';
import { ActionForm, FormField, Modal, SubmitButton } from '@/components/forms';
import { Button, Input, Select, Textarea } from '@/components/ui';
import { toInputAmount } from '@/lib/money';
import { updateClaimAction } from '../../actions-phase2';

export function ClaimEditor({
  slug,
  claim,
}: {
  slug: string;
  claim: { id: string; status: ClaimStatus; amount: number; currency: string; invoiceRef: string | null; receivedAmount: number | null; notes: string | null };
}) {
  const [status, setStatus] = useState<ClaimStatus>(claim.status === 'EXPECTED' ? 'CLAIMED' : claim.status === 'CLAIMED' ? 'RECEIVED' : claim.status);
  return (
    <Modal title="Update claim" trigger={(open) => <Button size="sm" onClick={open}>Update</Button>}>
      {(close) => (
        <ActionForm action={updateClaimAction.bind(null, slug, claim.id)} onSuccess={close} className="flex flex-col gap-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Status" name="status">
              <Select name="status" value={status} onChange={(e) => setStatus(e.target.value as ClaimStatus)}>
                <option value="EXPECTED">Expected</option>
                <option value="CLAIMED">Claimed (invoice sent)</option>
                <option value="RECEIVED">Received</option>
                <option value="WRITTEN_OFF">Written off</option>
              </Select>
            </FormField>
            <FormField label={`Claim amount (${claim.currency})`} name="amount">
              <Input name="amount" inputMode="decimal" defaultValue={toInputAmount(claim.amount)} />
            </FormField>
            <FormField label="Our claim / invoice ref" name="invoiceRef">
              <Input name="invoiceRef" defaultValue={claim.invoiceRef ?? ''} />
            </FormField>
            {status === 'RECEIVED' && (
              <FormField label={`Amount received (${claim.currency})`} name="receivedAmount">
                <Input name="receivedAmount" inputMode="decimal" defaultValue={toInputAmount(claim.receivedAmount ?? claim.amount)} required />
              </FormField>
            )}
          </div>
          <FormField label="Notes" name="notes"><Textarea name="notes" defaultValue={claim.notes ?? ''} className="min-h-16" /></FormField>
          <div className="flex justify-end"><SubmitButton>Save</SubmitButton></div>
        </ActionForm>
      )}
    </Modal>
  );
}
