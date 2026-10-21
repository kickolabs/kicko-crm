'use client';

import { useState } from 'react';
import type { TenantSettings } from '@kicko/db/provision';
import { ActionButton, ActionForm, CopyField, FormBanner, FormField, Modal, SubmitButton } from '@/components/forms';
import { Badge, Button, Card, CardHeader, Input, Select, Textarea } from '@/components/ui';
import { formatMoney, toInputAmount, type PlanStep } from '@/lib/money';
import { saveBillingSettingsAction, savePackageAction } from '../actions-phase2';

export function BillingDetailsForm({ slug, billing }: { slug: string; billing: TenantSettings['billing'] }) {
  const b = billing ?? {};
  const [saved, setSaved] = useState(false);
  return (
    <ActionForm action={saveBillingSettingsAction.bind(null, slug)} onSuccess={() => setSaved(true)} className="flex flex-col gap-4">
      {saved && <FormBanner tone="ok">Saved. New invoices and receipts use these details.</FormBanner>}
      <div className="grid gap-3.5 sm:grid-cols-2">
        <FormField label="Legal name on invoices" name="legalName"><Input name="legalName" defaultValue={b.legalName ?? ''} /></FormField>
        <FormField label="Invoice prefix" name="invoicePrefix" hint="e.g. INV → INV/26-27/0001"><Input name="invoicePrefix" defaultValue={b.invoicePrefix ?? 'INV'} maxLength={6} className="uppercase" /></FormField>
        <FormField label="GSTIN" name="gstin"><Input name="gstin" defaultValue={b.gstin ?? ''} className="uppercase" placeholder="33ABCDE1234F1Z5" /></FormField>
        <FormField label="PAN" name="pan"><Input name="pan" defaultValue={b.pan ?? ''} className="uppercase" /></FormField>
        <FormField label="Address" name="address" className="sm:col-span-2"><Textarea name="address" defaultValue={b.address ?? ''} className="min-h-16" /></FormField>
        <FormField label="Default tax" name="defaultTaxMode">
          <Select name="defaultTaxMode" defaultValue={b.defaultTaxMode ?? 'GST_INTRA'}>
            <option value="GST_INTRA">GST: CGST + SGST (same state)</option>
            <option value="GST_INTER">GST: IGST (other state)</option>
            <option value="NONE">No tax</option>
          </Select>
        </FormField>
        <FormField label="UPI ID" name="upiId"><Input name="upiId" defaultValue={b.upiId ?? ''} placeholder="agency@okhdfcbank" /></FormField>
        <FormField label="Bank details" name="bankDetails" className="sm:col-span-2"><Textarea name="bankDetails" defaultValue={b.bankDetails ?? ''} className="min-h-16" placeholder={'A/c name · A/c no. · IFSC · Branch'} /></FormField>
        <FormField label="Terms printed on invoices" name="terms" className="sm:col-span-2"><Textarea name="terms" defaultValue={b.terms ?? ''} className="min-h-16" placeholder="Fees once paid are non-refundable after visa lodgement…" /></FormField>
      </div>
      <div><SubmitButton>Save billing details</SubmitButton></div>
    </ActionForm>
  );
}

type Pkg = { id: string; name: string; description: string | null; productId: string | null; price: number; taxRate: number; plan: PlanStep[]; active: boolean };

export function PackagesCard({ slug, packages, products }: { slug: string; packages: Pkg[]; products: { id: string; label: string }[] }) {
  return (
    <Card>
      <CardHeader title="Service packages" sub="Your standard fees. Pick one when raising an invoice." action={<PackageEditor slug={slug} products={products} />} />
      <ul className="divide-y divide-line">
        {packages.length === 0 && <li className="px-5 py-5 text-sm text-muted">No packages yet.</li>}
        {packages.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold">{p.name} {!p.active && <Badge>Hidden</Badge>}</div>
              <div className="text-xs text-muted">
                {p.plan.length > 1 ? p.plan.map((s) => `${s.label} ${s.percent}%`).join(' · ') : 'Pay in full'} · GST {p.taxRate / 100}%
              </div>
            </div>
            <span className="text-sm font-extrabold">{formatMoney(p.price)}</span>
            <PackageEditor slug={slug} products={products} pkg={p} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PackageEditor({ slug, products, pkg }: { slug: string; products: { id: string; label: string }[]; pkg?: Pkg }) {
  return (
    <Modal wide title={pkg ? 'Edit package' : 'New package'} trigger={(open) => <Button size="sm" variant={pkg ? 'ghost' : 'secondary'} onClick={open}>{pkg ? 'Edit' : '+ Package'}</Button>}>
      {(close) => (
        <ActionForm action={savePackageAction.bind(null, slug, pkg?.id ?? null)} onSuccess={close} className="flex flex-col gap-3.5">
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Name" name="name" className="sm:col-span-2"><Input name="name" defaultValue={pkg?.name} placeholder="Canada study visa: full service" required /></FormField>
            <FormField label="For visa product" name="productId">
              <Select name="productId" defaultValue={pkg?.productId ?? ''}>
                <option value="">Any</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </Select>
            </FormField>
            <FormField label="Price before tax (₹)" name="price"><Input name="price" inputMode="decimal" defaultValue={toInputAmount(pkg?.price)} required /></FormField>
            <FormField label="GST %" name="taxRate"><Input name="taxRate" inputMode="decimal" defaultValue={pkg ? String(pkg.taxRate / 100) : '18'} /></FormField>
            <label className="flex items-end gap-2 pb-2.5 text-sm font-semibold">
              <input type="checkbox" name="active" defaultChecked={pkg?.active ?? true} className="h-4 w-4 accent-[#121417]" /> Offered
            </label>
          </div>
          <FormField label="Description" name="description"><Input name="description" defaultValue={pkg?.description ?? ''} /></FormField>
          <FormField label="Installment plan" name="plan" hint="One per line: label, percent, due after days. Leave empty to pay in full.">
            <Textarea name="plan" defaultValue={pkg?.plan.map((s) => `${s.label}, ${s.percent}, ${s.dueDays}`).join('\n') ?? 'On signing, 50, 0\nVisa lodged, 30, 30\nVisa decision, 20, 60'} className="min-h-24 font-mono text-[13px]" />
          </FormField>
          <div className="flex justify-end"><SubmitButton>Save package</SubmitButton></div>
        </ActionForm>
      )}
    </Modal>
  );
}
