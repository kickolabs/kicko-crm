'use client';

import { useState } from 'react';
import { ActionForm, SubmitButton } from '@/components/forms';
import { portalMessageAction } from '../actions';

export function ChatBox({ slug }: { slug: string }) {
  const [key, setKey] = useState(0);
  return (
    <ActionForm key={key} action={portalMessageAction.bind(null, slug)} onSuccess={() => setKey((k) => k + 1)} className="flex items-end gap-2">
      <label htmlFor="body" className="sr-only">Message</label>
      <textarea
        id="body"
        name="body"
        rows={2}
        placeholder="Type your message…"
        className="min-h-12 flex-1 resize-none rounded-[14px] bg-paper-3 px-4 py-3 text-[15px] outline-none focus:shadow-[inset_0_0_0_2px_var(--color-ink)]"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <SubmitButton size="lg">Send</SubmitButton>
    </ActionForm>
  );
}
