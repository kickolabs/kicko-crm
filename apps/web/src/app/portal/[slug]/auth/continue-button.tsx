'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Spinner } from '@/components/forms';
import { buttonCls } from '@/components/ui';
import { redeemAction } from '../actions';

export function ContinueButton({ slug, token }: { slug: string; token: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await redeemAction(slug, token);
            if (res && !res.ok) setError(res.error);
          })
        }
        className={buttonCls('primary', 'lg', 'w-full')}
      >
        {pending && <Spinner />} Open my portal
      </button>
      {error && (
        <div role="alert" className="rounded-[12px] bg-danger-bg px-4 py-3 text-sm text-danger">
          {error}{' '}
          <Link href={`/portal/${slug}/login`} className="font-semibold underline underline-offset-4">Get a new link</Link>
        </div>
      )}
    </div>
  );
}
