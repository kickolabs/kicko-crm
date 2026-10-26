'use client';

import { Eye, EyeOff, KeyRound, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ActionButton, ActionForm, FormField, Modal, SubmitButton } from '@/components/forms';
import { Button, Card, CardHeader, Input, Textarea } from '@/components/ui';
import { deleteVaultAction, revealVaultAction, saveVaultAction } from '../../actions';

type Entry = { id: string; label: string; portalUrl: string | null; username: string; notes: string | null; lastRevealedAt: string | null };
const PORTALS = ['IRCC / GCKey', 'ImmiAccount (Australia)', 'UKVI account', 'ESTA / CEAC (US)', 'VFS Global', 'University applicant portal', 'eMigrate'];

function EntryForm({ slug, clientId, entry, onDone }: { slug: string; clientId: string; entry?: Entry; onDone: () => void }) {
  return (
    <ActionForm action={saveVaultAction.bind(null, slug, clientId, entry?.id ?? null)} onSuccess={onDone} className="flex flex-col gap-3">
      <FormField label="Portal" name="label">
        <Input name="label" list="vault-portals" defaultValue={entry?.label} required />
      </FormField>
      <datalist id="vault-portals">{PORTALS.map((p) => <option key={p} value={p} />)}</datalist>
      <FormField label="Portal address" name="portalUrl"><Input name="portalUrl" type="url" defaultValue={entry?.portalUrl ?? ''} placeholder="https://" /></FormField>
      <FormField label="Username or email" name="username"><Input name="username" defaultValue={entry?.username} autoComplete="off" required /></FormField>
      <FormField label="Password" name="secret" hint={entry ? 'Leave empty to keep the saved password' : 'Stored encrypted. Viewing it is logged.'}>
        <Input name="secret" type="password" autoComplete="new-password" required={!entry} />
      </FormField>
      <FormField label="Notes" name="notes" hint="Security questions belong here, not in case notes"><Textarea name="notes" defaultValue={entry?.notes ?? ''} className="min-h-14" /></FormField>
      <div className="flex justify-end"><SubmitButton>Save</SubmitButton></div>
    </ActionForm>
  );
}

function Secret({ slug, id, canReveal }: { slug: string; id: string; canReveal: boolean }) {
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Hide again after 30 seconds.
  useEffect(() => {
    if (!value) return;
    const t = setTimeout(() => setValue(null), 30_000);
    return () => clearTimeout(t);
  }, [value]);
  if (!canReveal) return <span className="font-mono text-xs text-muted">••••••••</span>;
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-mono text-xs">{value ?? '••••••••'}</span>
      <button
        type="button"
        aria-label={value ? 'Hide password' : 'Show password'}
        className="grid size-7 place-items-center rounded-[8px] text-muted hover:bg-paper-2 hover:text-ink"
        onClick={async () => {
          if (value) return setValue(null);
          const res = await revealVaultAction(slug, id);
          if (res.ok) {
            setValue(res.data as string);
            setError(null);
          } else setError(res.error);
        }}
      >
        {value ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </span>
  );
}

/** Government and college portal logins for this client. */
export function VaultCard({ slug, clientId, entries, canWrite, canReveal }: { slug: string; clientId: string; entries: Entry[]; canWrite: boolean; canReveal: boolean }) {
  return (
    <Card>
      <CardHeader
        title="Portal logins"
        sub="Encrypted. Every view of a password is logged."
        action={
          canWrite && (
            <Modal title="Save a portal login" trigger={(open) => <Button size="sm" onClick={open}><Plus size={14} /> Add</Button>}>
              {(close) => <EntryForm slug={slug} clientId={clientId} onDone={close} />}
            </Modal>
          )
        }
      />
      <ul className="divide-y divide-line px-5">
        {entries.length === 0 && <li className="py-4 text-sm text-muted">None saved.</li>}
        {entries.map((e) => (
          <li key={e.id} className="flex flex-col gap-1 py-3">
            <div className="flex items-center gap-2">
              <KeyRound size={14} className="text-muted" />
              {e.portalUrl ? <a href={e.portalUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold hover:underline">{e.label}</a> : <span className="text-sm font-semibold">{e.label}</span>}
              {canWrite && (
                <span className="ml-auto flex gap-1">
                  <Modal title={`Edit ${e.label}`} trigger={(open) => <Button size="sm" variant="ghost" onClick={open}>Edit</Button>}>
                    {(close) => <EntryForm slug={slug} clientId={clientId} entry={e} onDone={close} />}
                  </Modal>
                  <ActionButton action={() => deleteVaultAction(slug, e.id)} variant="ghost" confirm={`Delete the ${e.label} login?`}>Delete</ActionButton>
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-5 text-xs">
              <span className="text-ink-2">{e.username}</span>
              <Secret slug={slug} id={e.id} canReveal={canReveal} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
