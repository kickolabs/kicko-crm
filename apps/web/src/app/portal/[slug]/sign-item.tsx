'use client';

import { PenLine } from 'lucide-react';
import { ActionForm, FormField, Modal, SubmitButton } from '@/components/forms';
import { Button, Input } from '@/components/ui';
import { blocksOf, runsOf } from '@/lib/merge';
import { portalSignAction } from './actions';

function Rendered({ body }: { body: string }) {
  return (
    <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto rounded-[12px] bg-paper-2 p-4 text-sm leading-relaxed">
      {blocksOf(body).map((b, i) => {
        const runs = runsOf(b.text).map((r, j) => (r.bold ? <strong key={j}>{r.text}</strong> : <span key={j}>{r.text}</span>));
        if (b.kind === 'h1') return <h3 key={i} className="text-lg font-extrabold">{runs}</h3>;
        if (b.kind === 'h2') return <h4 key={i} className="mt-2 font-bold">{runs}</h4>;
        if (b.kind === 'li') return <p key={i} className="pl-4 before:mr-2 before:content-['•']">{runs}</p>;
        if (b.kind === 'hr') return <hr key={i} className="border-line" />;
        if (b.kind === 'sign') return null;
        return <p key={i}>{runs}</p>;
      })}
    </div>
  );
}

/** A document the agency sent for signature: read it, type your name, sign. */
export function SignItem({ slug, doc }: { slug: string; doc: { id: string; name: string; body: string } }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[16px] bg-card p-4 shadow-[var(--shadow-card)]">
      <span className="grid size-10 place-items-center rounded-[12px] bg-lime"><PenLine size={18} /></span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{doc.name}</div>
        <div className="text-xs text-muted">Please read and sign</div>
      </div>
      <Modal wide title={doc.name} trigger={(open) => <Button variant="primary" onClick={open}>Read &amp; sign</Button>}>
        {(close) => (
          <ActionForm action={portalSignAction.bind(null, slug, doc.id)} onSuccess={close} className="flex flex-col gap-4">
            <Rendered body={doc.body} />
            <FormField label="Type your full name to sign" name="name"><Input name="name" autoComplete="name" required /></FormField>
            <label className="flex items-start gap-2.5 text-sm text-ink-2">
              <input type="checkbox" name="agree" required className="mt-0.5 size-4 accent-[var(--color-ink)]" />
              I have read this document and agree to it. Typing my name is my electronic signature.
            </label>
            <div className="flex justify-end"><SubmitButton>Sign</SubmitButton></div>
          </ActionForm>
        )}
      </Modal>
    </div>
  );
}
