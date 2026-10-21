'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Mail, MessageCircle } from 'lucide-react';
import { ActionButton, CopyField } from '@/components/forms';
import { Button } from '@/components/ui';
import { portalLinkAction, revokePortalAction } from '../actions-phase3';
import { sendPortalLinkWaAction } from '../actions-phase4';

export function PortalAccessCard({
  slug,
  clientId,
  phone,
  email,
  invitedAt,
  lastSeen,
  waConnected,
}: {
  slug: string;
  clientId: string;
  phone: string | null;
  email: string | null;
  invitedAt: string | null;
  lastSeen: string | null;
  waConnected: boolean;
}) {
  const router = useRouter();
  const [link, setLink] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const make = (emailIt: boolean) =>
    start(async () => {
      const res = await portalLinkAction(slug, clientId, emailIt);
      if (res.ok && res.data) {
        setLink(res.data.link);
        setError(null);
        setNote(res.data.emailed ? `Emailed to ${email}.` : 'Copy it, or share it on WhatsApp.');
      } else if (!res.ok) setError(res.error);
    });
  const sendWa = () =>
    start(async () => {
      const res = await sendPortalLinkWaAction(slug, clientId);
      if (res.ok) {
        setError(null);
        setLink(null);
        setNote('Sent on WhatsApp. It appears in the conversation.');
        router.refresh();
      } else setError(res.error);
    });
  const share = link && phone ? `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Here is your client portal link. Track your visa journey, upload documents and pay fees: ${link}`)}` : null;

  return (
    <section className="card flex flex-col gap-3 p-5" aria-label="Client portal">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold">Client portal</h2>
        <span className="text-xs font-semibold text-muted">{lastSeen ? `Last seen ${lastSeen}` : invitedAt ? 'Invited · not opened yet' : 'Not invited'}</span>
      </div>
      <p className="text-[13px] leading-relaxed text-muted">The client sees their journey, uploads requested documents, pays and messages you. Links work once and expire in 7 days.</p>
      <div className="flex flex-wrap gap-2">
        {waConnected && phone && <Button size="sm" variant="primary" disabled={pending} onClick={sendWa}><MessageCircle size={13} /> Send on WhatsApp</Button>}
        <Button size="sm" variant={waConnected && phone ? 'secondary' : 'primary'} disabled={pending} onClick={() => make(false)}>Create portal link</Button>
        {email && <Button size="sm" disabled={pending} onClick={() => make(true)}><Mail size={13} /> Email it</Button>}
        {invitedAt && <ActionButton action={() => revokePortalAction(slug, clientId)} variant="ghost" confirm="Sign this client out of the portal on all devices?">Revoke access</ActionButton>}
      </div>
      {error && <p role="alert" className="text-xs font-medium text-danger">{error}</p>}
      {note && !link && <p role="status" className="text-xs font-semibold text-ok">{note}</p>}
      {link && (
        <div className="flex flex-col gap-2 rounded-[12px] bg-lime-soft p-3">
          <CopyField value={link} label="Portal link" />
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-ink-2">{note}</span>
            {share && <a href={share} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-semibold underline underline-offset-4"><MessageCircle size={13} /> WhatsApp</a>}
          </div>
        </div>
      )}
    </section>
  );
}
