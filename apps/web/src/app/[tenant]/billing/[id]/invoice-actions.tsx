'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Download, Link2 } from 'lucide-react';
import type { InvoiceStatus } from '@kicko/db';
import { ActionButton, ActionForm, CopyField, FormField, Modal, SubmitButton } from '@/components/forms';
import { Button, Input, Select, buttonCls } from '@/components/ui';
import { formatMoney, toInputAmount } from '@/lib/money';
import { paymentLinkAction, recordPaymentAction, setInvoiceStatusAction } from '../../actions-phase2';

export function InvoiceActions({
  slug,
  invoiceId,
  status,
  pdfUrl,
  canWrite,
  canVoid,
  gateway,
  openLink,
}: {
  slug: string;
  invoiceId: string;
  status: InvoiceStatus;
  pdfUrl: string;
  canWrite: boolean;
  canVoid: boolean;
  /** Connected payment gateway, if any. */
  gateway: { name: string; notifies: boolean } | null;
  openLink: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [link, setLink] = useState<string | null>(openLink);
  const [err, setErr] = useState<string | null>(null);
  const collectable = status === 'ISSUED' || status === 'PARTIALLY_PAID';

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        <a href={pdfUrl} target="_blank" rel="noreferrer" className={buttonCls('secondary', 'md')}>
          <Download size={15} /> PDF
        </a>
        {canWrite && status === 'DRAFT' && (
          <ActionButton action={() => setInvoiceStatusAction(slug, invoiceId, 'ISSUED')} variant="primary" size="md">Issue invoice</ActionButton>
        )}
        {canWrite && collectable && gateway && (
          <Button
            variant="lime"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await paymentLinkAction(slug, invoiceId);
                if (res.ok && res.data) {
                  setLink(res.data);
                  setErr(null);
                  router.refresh();
                } else if (!res.ok) setErr(res.error);
              })
            }
          >
            <Link2 size={15} /> {pending ? 'Creating…' : 'Payment link'}
          </Button>
        )}
        {canWrite && canVoid && status !== 'VOID' && (
          <ActionButton action={() => setInvoiceStatusAction(slug, invoiceId, 'VOID')} variant="danger" size="md" confirm="Void this invoice? The number stays used.">Void</ActionButton>
        )}
      </div>
      {err && <span role="alert" className="text-xs font-medium text-danger">{err}</span>}
      {link && (
        <div className="w-full max-w-md">
          <CopyField value={link} label="Payment link" />
          {gateway?.notifies && <span className="mt-1 block text-right text-[11px] text-muted">{gateway.name} also sends this to the client by SMS/email.</span>}
        </div>
      )}
      {canWrite && collectable && !gateway && (
        <span className="text-[11px] text-muted">Connect a payment gateway in Settings → Billing to send payment links.</span>
      )}
    </div>
  );
}

export function RecordPayment({ slug, invoiceId, balance, today }: { slug: string; invoiceId: string; balance: number; today: string }) {
  return (
    <Modal title="Record a payment" trigger={(open) => <Button variant="lime" className="w-full" onClick={open}>Record payment</Button>}>
      {(close) => (
        <ActionForm action={recordPaymentAction.bind(null, slug, invoiceId)} onSuccess={close} className="flex flex-col gap-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Amount (₹)" name="amount" hint={`Balance ${formatMoney(balance)}`}>
              <Input name="amount" inputMode="decimal" defaultValue={toInputAmount(balance)} required autoFocus />
            </FormField>
            <FormField label="Received on" name="paidAt">
              <Input name="paidAt" type="date" defaultValue={today} max={today} required />
            </FormField>
            <FormField label="Method" name="method">
              <Select name="method" defaultValue="UPI">
                <option value="UPI">UPI</option>
                <option value="BANK_TRANSFER">Bank transfer (NEFT/IMPS/RTGS)</option>
                <option value="CASH">Cash</option>
                <option value="CARD">Card (POS)</option>
                <option value="CHEQUE">Cheque</option>
                <option value="OTHER">Other</option>
              </Select>
            </FormField>
            <FormField label="Reference" name="reference" hint="UTR, cheque no., etc.">
              <Input name="reference" />
            </FormField>
          </div>
          <div className="flex justify-end"><SubmitButton>Record & issue receipt</SubmitButton></div>
        </ActionForm>
      )}
    </Modal>
  );
}
