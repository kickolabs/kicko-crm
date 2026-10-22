'use client';

import { ActionButton, ActionForm, SubmitButton } from '@/components/forms';
import { Input } from '@/components/ui';
import { addBranchAction, removeBranchAction, updateBranchAction } from '../actions-branches';

export function BranchRow({ slug, b, canRemove }: { slug: string; b: { id: string; name: string; city: string | null; people: number }; canRemove: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <ActionForm action={updateBranchAction.bind(null, slug, b.id)} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`bn-${b.id}`}>Branch name</label>
        <Input id={`bn-${b.id}`} name="name" defaultValue={b.name} className="h-9 w-52" required />
        <label className="sr-only" htmlFor={`bc-${b.id}`}>City</label>
        <Input id={`bc-${b.id}`} name="city" defaultValue={b.city ?? ''} placeholder="City" className="h-9 w-40" />
        <SubmitButton size="sm" variant="ghost">Save</SubmitButton>
        <span className="text-xs text-muted">{b.people} {b.people === 1 ? 'person' : 'people'}</span>
      </ActionForm>
      {canRemove && (
        <ActionButton action={() => removeBranchAction(slug, b.id)} variant="ghost" confirm={`Remove ${b.name}? People, leads and cases stay, just without a branch.`}>
          Remove
        </ActionButton>
      )}
    </li>
  );
}

export function AddBranch({ slug }: { slug: string }) {
  return (
    <ActionForm action={addBranchAction.bind(null, slug)} resetOnSuccess className="flex flex-wrap items-end gap-2 p-5">
      <label className="flex flex-col gap-1 text-sm font-medium">
        New branch name
        <Input name="name" placeholder="e.g. Coimbatore" className="h-10 w-56" required />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        City
        <Input name="city" placeholder="Optional" className="h-10 w-44" />
      </label>
      <SubmitButton>Add branch</SubmitButton>
    </ActionForm>
  );
}
