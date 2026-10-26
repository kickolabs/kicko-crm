'use client';

import { useState } from 'react';
import { Select } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { setCasePackageAction } from '../../actions';

/** The service package the client bought; agreements and the fee schedule use it. */
export function PackagePicker({ slug, caseId, value, packages, canEdit }: { slug: string; caseId: string; value: string | null; packages: { id: string; name: string; price: number }[]; canEdit: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const current = packages.find((p) => p.id === value);
  return (
    <div className="flex flex-col gap-1.5 border-b border-line px-5 py-3">
      <label htmlFor={`package-${caseId}`} className="eyebrow">Service package</label>
      {canEdit ? (
        <Select
          id={`package-${caseId}`}
          defaultValue={value ?? ''}
          onChange={async (e) => {
            const res = await setCasePackageAction(slug, caseId, e.target.value || null);
            setError(res.ok ? null : res.error);
          }}
        >
          <option value="">Not chosen</option>
          {packages.map((p) => <option key={p.id} value={p.id}>{p.name} · {formatMoney(p.price)}</option>)}
        </Select>
      ) : (
        <span className="text-sm font-semibold">{current ? `${current.name} · ${formatMoney(current.price)}` : 'Not chosen'}</span>
      )}
      {error && <span role="alert" className="text-xs font-medium text-danger">{error}</span>}
      <span className="text-xs text-muted">Agreements use the latest invoice&apos;s fees, or this package until there is one.</span>
    </div>
  );
}
