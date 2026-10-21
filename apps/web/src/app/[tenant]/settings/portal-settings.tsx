'use client';

import { useState } from 'react';
import { ActionForm, CopyField, FormBanner, FormField, SubmitButton } from '@/components/forms';
import { Card, CardHeader, Input, Select, Textarea } from '@/components/ui';
import { savePortalSettingsAction } from '../actions-phase3';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function PortalSettings({
  slug,
  loginUrl,
  emailOn,
  cfg,
}: {
  slug: string;
  loginUrl: string;
  emailOn: boolean;
  cfg: { bookingEnabled: boolean; days: number[]; start: string; end: string; slotMinutes: number; welcome?: string };
}) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Portal address" sub="Clients sign in here with a one-time link. You can also send links from each client's profile." />
        <div className="flex flex-col gap-2 p-5">
          <CopyField value={loginUrl} label="Portal sign-in page" />
          <p className="text-xs text-muted">
            {emailOn
              ? 'Self-service links are emailed to the client.'
              : 'Email delivery is not configured (RESEND_API_KEY). Clients can still sign in with links you share on WhatsApp.'}
          </p>
        </div>
      </Card>
      <Card>
        <CardHeader title="Booking & welcome" />
        <ActionForm action={savePortalSettingsAction.bind(null, slug)} onSuccess={() => setSaved(true)} className="flex flex-col gap-4 p-5">
          {saved && <FormBanner tone="ok">Saved.</FormBanner>}
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" name="bookingEnabled" defaultChecked={cfg.bookingEnabled} className="h-4 w-4 accent-[#121417]" />
            Let clients book meetings with their counsellor
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-semibold text-ink-2">Working days</legend>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d, i) => (
                <label key={d} className="flex cursor-pointer items-center gap-1.5 rounded-full bg-paper-3 px-3 py-1.5 text-sm font-semibold has-[:checked]:bg-ink has-[:checked]:text-paper">
                  <input type="checkbox" name="days" value={i} defaultChecked={cfg.days.includes(i)} className="sr-only" />
                  {d}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Opens" name="start"><Input name="start" type="time" defaultValue={cfg.start} /></FormField>
            <FormField label="Closes" name="end"><Input name="end" type="time" defaultValue={cfg.end} /></FormField>
            <FormField label="Slot length" name="slotMinutes">
              <Select name="slotMinutes" defaultValue={String(cfg.slotMinutes)}>
                {[15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
              </Select>
            </FormField>
          </div>
          <FormField label="Welcome note" name="welcome" hint="Shown to clients who don't have a case yet.">
            <Textarea name="welcome" defaultValue={cfg.welcome ?? ''} className="min-h-16" />
          </FormField>
          <div><SubmitButton>Save portal settings</SubmitButton></div>
        </ActionForm>
      </Card>
    </div>
  );
}
