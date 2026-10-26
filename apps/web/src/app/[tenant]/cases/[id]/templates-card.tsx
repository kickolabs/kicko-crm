'use client';

import { FileSignature, FileText } from 'lucide-react';
import { useState } from 'react';
import { FormBanner, Modal } from '@/components/forms';
import { Card, CardHeader, Button, Textarea } from '@/components/ui';
import { generateDocumentAction, previewDocumentAction } from '../../actions';

type Note = { tone: 'ok' | 'warn' | 'error'; text: string };
type Template = { id: string; name: string; signature: boolean };

const resultNote = (t: Template, missing: string[]): Note =>
  missing.length
    ? { tone: 'warn', text: `${t.name} created with blanks for: ${missing.join(', ')}. Fill those in on the case or client, then create it again.` }
    : { tone: 'ok', text: `${t.name} created${t.signature ? ' and waiting for the client to sign in their portal' : ''}.` };

/** Generate an agreement or letter for this case from the agency's templates. */
export function TemplatesCard({ slug, caseId, templates }: { slug: string; caseId: string; templates: Template[] }) {
  const [note, setNote] = useState<Note | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!templates.length) return null;
  return (
    <Card>
      <CardHeader title="Agreements & letters" sub="Filled in from the case; appears under Documents" />
      {note && <div className="px-5 pt-3"><FormBanner tone={note.tone}>{note.text}</FormBanner></div>}
      <ul className="divide-y divide-line px-5">
        {templates.map((t) => (
          <li key={t.id} className="flex items-center gap-2 py-2.5">
            {t.signature ? <FileSignature size={15} className="text-muted" /> : <FileText size={15} className="text-muted" />}
            <span className="min-w-0 flex-1 text-sm font-semibold">{t.name}</span>
            <Modal wide title={`${t.name}: check before ${t.signature ? 'sending' : 'creating'}`} trigger={(open) => <Button size="sm" variant="ghost" disabled={busy !== null} onClick={open}><span className="sr-only">{t.name}: </span>Edit first</Button>}>
              {(close) => <EditFirst slug={slug} caseId={caseId} template={t} onDone={(n) => (setNote(n), close())} />}
            </Modal>
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={async () => {
                setBusy(t.id);
                const res = await generateDocumentAction(slug, caseId, t.id);
                setBusy(null);
                setNote(res.ok ? resultNote(t, (res.data as string[]) ?? []) : { tone: 'error', text: res.error });
              }}
            >
              <span className="sr-only">{t.name}: </span>
              {busy === t.id ? 'Creating…' : t.signature ? 'Send to sign' : 'Create'}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * The template filled in for this case, editable for this client only (the template
 * itself is unchanged). Loads when opened, from a click, never from an effect.
 */
function EditFirst({ slug, caseId, template, onDone }: { slug: string; caseId: string; template: Template; onDone: (n: Note) => void }) {
  const [body, setBody] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (body === null) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">
          See {template.name.toLowerCase()} filled in with this case&apos;s details and change anything for this client, such as a fee or a clause. Your template stays as it is.
        </p>
        {error && <FormBanner tone="error">{error}</FormBanner>}
        <div className="flex justify-end">
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await previewDocumentAction(slug, caseId, template.id);
              setBusy(false);
              if (!res.ok) return setError(res.error);
              setBody(res.data!.text);
              setMissing(res.data!.missing);
            }}
          >
            {busy ? 'Filling in…' : 'Fill in from the case'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {missing.length > 0 && (
        <FormBanner tone="warn">No value yet for: {missing.join(', ')}. Replace the ________ blanks below, or fill them in on the case and start again.</FormBanner>
      )}
      {error && <FormBanner tone="error">{error}</FormBanner>}
      <Textarea aria-label="Document text" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[50vh] font-mono text-[13px]" />
      <p className="text-xs text-muted">
        # heading, ## subheading, - list item, **bold**, --- line{template.signature ? ', [signature] where the client signs' : ''}.
      </p>
      <div className="flex justify-end">
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const res = await generateDocumentAction(slug, caseId, template.id, body);
            setBusy(false);
            if (!res.ok) return setError(res.error);
            onDone(resultNote(template, (res.data as string[]) ?? []));
          }}
        >
          {busy ? 'Creating…' : template.signature ? 'Send to sign' : 'Create'}
        </Button>
      </div>
    </div>
  );
}
