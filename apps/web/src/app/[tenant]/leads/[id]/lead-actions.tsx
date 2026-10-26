'use client';

import clsx from 'clsx';
import { Combobox } from '@/components/combobox';
import { countryName } from '@/lib/countries';
import type { Lead, LeadStatus } from '@kicko/db';
import { ActionButton, ActionForm, FormField, Modal, SubmitButton } from '@/components/forms';
import { Button, Input } from '@/components/ui';
import { LEAD_STATUS_LABEL } from '@/lib/constants';
import { convertLeadAction, markLostAction, setLeadStatusAction } from '../../actions';
import { displayPackValue, type PackValues } from '@/lib/pack-fields';
import type { PackFormProps } from '@/server/library';
import { EditLeadForm, type LeadProduct } from '../lead-form';

type Product = LeadProduct;
const STEPS: LeadStatus[] = ['NEW', 'CONTACTED', 'QUALIFIED', 'CONSULT_BOOKED'];
const LOST_REASONS = ['Not eligible', 'Budget', 'Chose another agency', 'Not reachable', 'Plans postponed', 'Just browsing'];

export function StatusStepper({ slug, lead, disabled }: { slug: string; lead: Lead; disabled: boolean }) {
  const idx = STEPS.indexOf(lead.status);
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Lead status">
      {STEPS.map((s, i) => {
        const active = s === lead.status;
        const done = idx > i;
        return active || disabled ? (
          <span
            key={s}
            aria-current={active ? 'step' : undefined}
            className={clsx(
              'rounded-full px-3 py-1.5 text-xs font-bold',
              active ? 'bg-ink text-paper' : done ? 'bg-ink/10 text-ink-2' : 'bg-card text-muted shadow-[inset_0_0_0_1px_var(--color-line-2)]',
            )}
          >
            {LEAD_STATUS_LABEL[s]}
          </span>
        ) : (
          <ActionButton
            key={s}
            action={() => setLeadStatusAction(slug, lead.id, s)}
            variant={done ? 'ghost' : 'secondary'}
            className={clsx('h-auto rounded-full px-3 py-1.5 text-xs', done && 'bg-ink/10')}
          >
            {LEAD_STATUS_LABEL[s]}
          </ActionButton>
        );
      })}
    </div>
  );
}

export function LeadToolbar({
  slug,
  lead,
  products,
  team,
  form,
}: {
  slug: string;
  lead: Lead;
  products: Product[];
  team: { userId: string; name: string }[];
  form: PackFormProps;
}) {
  if (lead.clientId) return null;
  const names = new Map(Object.values(form.lookups).flat().map((o) => [o.key, o.name]));
  const carried = [
    ...(lead.interestCountry ? [['Destination', countryName(lead.interestCountry)]] : []),
    ...form.fields
      .filter((f) => f.carry && (lead.packData as PackValues)[f.key] != null)
      .map((f) => [f.label, displayPackValue(f, (lead.packData as PackValues)[f.key], (_t, k) => names.get(k) ?? k)]),
  ];
  return (
    <div className="flex flex-wrap gap-2">
      <Modal wide title="Edit lead" trigger={(open) => <Button onClick={open}>Edit</Button>}>
        {(close) => <EditLeadForm slug={slug} lead={lead} products={products} team={team} form={form} onDone={close} />}
      </Modal>
      {lead.status !== 'LOST' ? (
        <Modal title="Mark as lost" trigger={(open) => <Button onClick={open}>Mark lost</Button>}>
          {(close) => (
            <ActionForm action={markLostAction.bind(null, slug, lead.id)} onSuccess={close} className="flex flex-col gap-4">
              <FormField label="Reason" name="reason">
                <Input name="reason" list="lost-reasons" placeholder="Pick or type a reason" required autoFocus />
                <datalist id="lost-reasons">
                  {LOST_REASONS.map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
              </FormField>
              <div className="flex justify-end">
                <SubmitButton variant="danger">Mark lost</SubmitButton>
              </div>
            </ActionForm>
          )}
        </Modal>
      ) : (
        <ActionButton action={() => setLeadStatusAction(slug, lead.id, 'CONTACTED')} size="md">
          Reopen
        </ActionButton>
      )}
      <Modal
        title="Convert to client"
        trigger={(open) => (
          <Button variant="primary" onClick={open}>
            Convert to client →
          </Button>
        )}
      >
        {() => (
          <ActionForm action={convertLeadAction.bind(null, slug, lead.id)} className="flex flex-col gap-4">
            <p className="text-sm text-ink-2">
              Creates a client profile (or links an existing one with the same phone or email) and moves open tasks and
              notes across. Pick a visa product to open a case straight away.
            </p>
            {carried.length > 0 && (
              <div className="rounded-[12px] bg-paper-2 px-4 py-3 text-sm">
                <div className="eyebrow mb-1.5">Carried over to the client</div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  {carried.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted">{k}</dt>
                      <dd className="font-semibold">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-1.5 text-xs text-muted">You can review and change these on the client profile.</p>
              </div>
            )}
            <FormField
              label="Open a case for"
              name="productId"
              hint={
                <>
                  Your agency&apos;s visa workflows. Need another country?{' '}
                  <a href={`/${slug}/settings?tab=workflows${lead.interestCountry ? `&country=${lead.interestCountry}` : ''}`} className="font-semibold text-ink underline underline-offset-4">
                    Add it in Settings
                  </a>
                </>
              }
            >
              {/* The lead's destination first, then the rest by country; type to search. */}
              <Combobox
                name="productId"
                defaultValue={lead.productId ?? ''}
                emptyLabel="Don't open a case yet"
                placeholder="Type a country or visa"
                groupOrder={lead.interestCountry ? [`For ${countryName(lead.interestCountry)}`] : []}
                options={products.map((p) => ({
                  key: p.id,
                  name: `${countryName(p.country)} · ${p.name}`,
                  group: p.country === lead.interestCountry ? `For ${countryName(p.country)}` : countryName(p.country),
                  search: p.country,
                }))}
              />
            </FormField>
            <div className="flex justify-end">
              <SubmitButton>Convert</SubmitButton>
            </div>
          </ActionForm>
        )}
      </Modal>
    </div>
  );
}
