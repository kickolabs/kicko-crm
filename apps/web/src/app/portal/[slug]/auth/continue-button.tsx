'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { SubmitButton } from '@/components/forms';
import { redeemFormAction } from '../actions';

// A real form, not an onClick: a tap before the page's JavaScript has loaded (slow
// phones) still signs the client in, instead of silently doing nothing.
export function ContinueButton({ slug, token }: { slug: string; token: string }) {
  const [state, action] = useActionState(redeemFormAction.bind(null, slug, token), null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <SubmitButton size="lg" className="w-full">Open my portal</SubmitButton>
      {state && !state.ok && (
        <div role="alert" className="rounded-[12px] bg-danger-bg px-4 py-3 text-sm text-danger">
          {state.error}{' '}
          <Link href={`/portal/${slug}/login`} className="font-semibold underline underline-offset-4">Get a new link</Link>
        </div>
      )}
    </form>
  );
}
