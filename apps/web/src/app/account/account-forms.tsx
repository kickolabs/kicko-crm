'use client';

import { useActionState, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { ActionButton, ActionForm, FormBanner, FormField, SubmitButton } from '@/components/forms';
import { Badge, Button, Input } from '@/components/ui';
import { changePasswordAction, confirmTwoFactorAction, disableTwoFactorAction, newBackupCodesAction, revokeOtherSessionsAction, startTwoFactorAction } from './actions';

function Codes({ codes }: { codes: string[] }) {
  const text = codes.join('\n');
  return (
    <div className="flex flex-col gap-2">
      <ul aria-label="Backup codes" className="grid grid-cols-2 gap-1.5 rounded-[12px] bg-paper-3 p-3 font-mono text-sm sm:grid-cols-5">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <Button size="sm" onClick={() => void navigator.clipboard?.writeText(text)}>Copy</Button>
        <a className="font-semibold text-ink underline" href={`data:text/plain;charset=utf-8,${encodeURIComponent(`Kicko backup codes\n\n${text}\n`)}`} download="kicko-backup-codes.txt">Download</a>
        Keep them somewhere safe. Each code works once if you lose your phone.
      </div>
    </div>
  );
}

export function TwoFactorCard({ enabled, required }: { enabled: boolean; required: boolean }) {
  const [setup, startAction] = useActionState(startTwoFactorAction, null);
  const [codes, codesAction] = useActionState(newBackupCodesAction, null);
  const [disabling, setDisabling] = useState(false);

  if (enabled) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-ok"><ShieldCheck size={18} aria-hidden="true" /> Two-step sign-in is on</div>
        <p className="text-sm text-muted">Each sign-in asks for a code from your authenticator app, unless you chose to trust that browser.</p>
        {codes?.ok && codes.data ? (
          <Codes codes={codes.data} />
        ) : (
          <form action={codesAction} className="flex flex-wrap items-end gap-2">
            {codes && !codes.ok && <FormBanner tone="error">{codes.error}</FormBanner>}
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
              Password
              <Input name="password" type="password" autoComplete="current-password" aria-label="Password for new backup codes" className="w-56" />
            </label>
            <SubmitButton variant="secondary">New backup codes</SubmitButton>
          </form>
        )}
        {required ? (
          <p className="text-xs text-muted">Your agency requires two-step sign-in, so it can’t be turned off.</p>
        ) : disabling ? (
          <ActionForm action={disableTwoFactorAction} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
              Password
              <Input name="password" type="password" autoComplete="current-password" aria-label="Password to turn off" className="w-56" />
            </label>
            <SubmitButton variant="danger">Turn off</SubmitButton>
            <Button variant="ghost" onClick={() => setDisabling(false)}>Cancel</Button>
          </ActionForm>
        ) : (
          <Button variant="ghost" className="self-start" onClick={() => setDisabling(true)}>Turn off two-step sign-in</Button>
        )}
      </div>
    );
  }

  if (setup?.ok && setup.data) {
    const d = setup.data;
    return (
      <div className="flex flex-col gap-5">
        <ol className="flex flex-col gap-5 text-sm">
          <li className="flex flex-col gap-2">
            <span className="font-semibold">1. Scan this with Google Authenticator, Microsoft Authenticator or 1Password</span>
            <div className="flex flex-wrap items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={d.qr} alt="QR code for your authenticator app" width={168} height={168} className="rounded-[12px] shadow-[inset_0_0_0_1px_var(--color-line)]" />
              <div className="text-xs text-muted">
                Can’t scan? Enter this key:
                <div className="mt-1 font-mono text-sm break-all text-ink" aria-label="Setup key">{d.secret}</div>
              </div>
            </div>
          </li>
          <li className="flex flex-col gap-2">
            <span className="font-semibold">2. Save your backup codes</span>
            <Codes codes={d.backupCodes} />
          </li>
          <li className="flex flex-col gap-2">
            <span className="font-semibold">3. Enter the 6-digit code the app shows</span>
            <ActionForm action={confirmTwoFactorAction} className="flex flex-wrap items-end gap-2">
              <FormField label="Code" name="code">
                <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} className="w-36 text-center tracking-[0.2em]" />
              </FormField>
              <SubmitButton>Turn on</SubmitButton>
            </ActionForm>
          </li>
        </ol>
      </div>
    );
  }

  return (
    <form action={startAction} className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Protect client passports and records: after your password, Kicko asks for a 6-digit code from an app on your phone. Someone with your password alone can’t get in.
      </p>
      {setup && !setup.ok && <FormBanner tone="error">{setup.error}</FormBanner>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
          Confirm your password
          <Input name="password" type="password" autoComplete="current-password" aria-label="Password to set up two-step sign-in" className="w-56" />
        </label>
        <SubmitButton>Set up two-step sign-in</SubmitButton>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const [done, setDone] = useState(false);
  return (
    <ActionForm action={changePasswordAction} resetOnSuccess onSuccess={() => setDone(true)} className="grid gap-3 sm:grid-cols-3">
      {done && <div className="sm:col-span-3"><FormBanner tone="ok">Password changed. Other devices were signed out.</FormBanner></div>}
      <FormField label="Current password" name="current"><Input id="current" name="current" type="password" autoComplete="current-password" /></FormField>
      <FormField label="New password" name="next"><Input id="next" name="next" type="password" autoComplete="new-password" /></FormField>
      <FormField label="Repeat new password" name="confirm"><Input id="confirm" name="confirm" type="password" autoComplete="new-password" /></FormField>
      <SubmitButton variant="secondary" className="self-start sm:col-span-3">Change password</SubmitButton>
    </ActionForm>
  );
}

export function SessionsList({ sessions }: { sessions: { id: string; device: string; ip: string | null; when: string; current: boolean }[] }) {
  const others = sessions.filter((s) => !s.current).length;
  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y divide-line">
        {sessions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
            <span className="font-semibold">{s.device}</span>
            {s.current && <Badge tone="ok">This device</Badge>}
            <span className="ml-auto text-xs text-muted">{s.ip ? `${s.ip} · ` : ''}signed in {s.when}</span>
          </li>
        ))}
      </ul>
      {others > 0 && (
        <ActionButton action={revokeOtherSessionsAction} confirm="Sign out of Kicko on every other device?">
          Sign out {others} other device{others === 1 ? '' : 's'}
        </ActionButton>
      )}
    </div>
  );
}
