'use client';

import { FileSignature, FileText } from 'lucide-react';
import { useState } from 'react';
import { FormBanner } from '@/components/forms';
import { Card, CardHeader, Button } from '@/components/ui';
import { generateDocumentAction } from '../../actions';

/** Generate an agreement or letter for this case from the agency's templates. */
export function TemplatesCard({ slug, caseId, templates }: { slug: string; caseId: string; templates: { id: string; name: string; signature: boolean }[] }) {
  const [note, setNote] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!templates.length) return null;
  return (
    <Card>
      <CardHeader title="Agreements & letters" sub="Filled in from the case; appears under Documents" />
      {note && <div className="px-5 pt-3"><FormBanner tone={note.tone}>{note.text}</FormBanner></div>}
      <ul className="divide-y divide-line px-5">
        {templates.map((t) => (
          <li key={t.id} className="flex items-center gap-3 py-2.5">
            {t.signature ? <FileSignature size={15} className="text-muted" /> : <FileText size={15} className="text-muted" />}
            <span className="min-w-0 flex-1 text-sm font-semibold">{t.name}</span>
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={async () => {
                setBusy(t.id);
                const res = await generateDocumentAction(slug, caseId, t.id);
                setBusy(null);
                if (!res.ok) return setNote({ tone: 'error', text: res.error });
                const missing = (res.data as string[]) ?? [];
                setNote(
                  missing.length
                    ? { tone: 'warn', text: `${t.name} created with blanks for: ${missing.join(', ')}. Fill those in on the case or client, then create it again.` }
                    : { tone: 'ok', text: `${t.name} created${t.signature ? ' and waiting for the client to sign in their portal' : ''}.` },
                );
              }}
            >
              {busy === t.id ? 'Creating…' : t.signature ? 'Send to sign' : 'Create'}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
