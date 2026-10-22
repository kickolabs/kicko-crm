'use client';

import { useState } from 'react';
import { Select } from '@/components/ui';
import type { ActionResult } from '@/lib/action';

/** A branch picker that saves on change (team members, leads, cases). */
export function BranchSelect({
  id,
  value,
  branches,
  save,
  label = 'Branch',
  className = 'h-9 w-44',
}: {
  id: string;
  value: string | null;
  branches: { id: string; name: string }[];
  save: (branchId: string) => Promise<ActionResult>;
  label?: string;
  className?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <label className="sr-only" htmlFor={id}>{label}</label>
      <Select
        id={id}
        defaultValue={value ?? ''}
        className={className}
        onChange={async (e) => {
          const res = await save(e.target.value);
          setError(res.ok ? null : res.error);
        }}
      >
        <option value="">No branch</option>
        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </Select>
      {error && <span role="alert" className="text-xs font-medium text-danger">{error}</span>}
    </span>
  );
}
