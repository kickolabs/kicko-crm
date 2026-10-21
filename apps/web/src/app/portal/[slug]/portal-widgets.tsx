'use client';

import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { Spinner } from '@/components/forms';
import { buttonCls } from '@/components/ui';
import { portalCancelAction, portalFinishUploadAction, portalPayAction, portalStartUploadAction } from './actions';

const EXT: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export function NeedItem({
  slug,
  doc,
}: {
  slug: string;
  doc: { id: string; name: string; group: string; status: string; rejectionReason: string | null };
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  async function upload(file: File) {
    setError(null);
    setBusy(true);
    const contentType = file.type || EXT[file.name.split('.').pop()?.toLowerCase() ?? ''] || '';
    const s = await portalStartUploadAction(slug, doc.id, { fileName: file.name, contentType, size: file.size });
    if (!s.ok || !s.data) {
      setBusy(false);
      return setError(s.ok ? 'Upload failed' : s.error);
    }
    const put = await fetch(s.data.url, { method: 'PUT', headers: s.data.headers, body: file }).catch(() => null);
    if (!put?.ok) {
      setBusy(false);
      return setError('Upload failed. Check your connection and try again.');
    }
    const f = await portalFinishUploadAction(slug, doc.id, { key: s.data.key, fileName: file.name, contentType, size: file.size });
    setBusy(false);
    if (!f.ok) return setError(f.error);
    setDone(true);
    // Let the client see the confirmation before the card moves to "Being checked".
    setTimeout(() => start(() => router.refresh()), 1500);
  }

  return (
    <div className={clsx('flex flex-wrap items-center gap-4 rounded-[16px] bg-card p-5 shadow-[0_0_0_1px_var(--color-line)]', done && 'shadow-[0_0_0_1.5px_#9BC93A]', doc.status === 'REJECTED' && !done && 'shadow-[0_0_0_1.5px_#E8862A]')}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-semibold">{doc.name}</span>
        {doc.status === 'REJECTED' && doc.rejectionReason ? (
          <span className="text-sm font-medium text-warn-ink">Please upload again: {doc.rejectionReason}</span>
        ) : (
          <span className="text-sm text-muted">{doc.group}. A clear photo or PDF is fine.</span>
        )}
        {error && <span role="alert" className="text-sm font-medium text-danger">{error}</span>}
      </div>
      <input
        ref={input}
        type="file"
        className="sr-only"
        accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx"
        aria-label={`Upload ${doc.name}`}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void upload(f);
        }}
      />
      <button
        type="button"
        disabled={busy || done}
        onClick={() => input.current?.click()}
        className={buttonCls(done ? 'secondary' : 'primary', 'lg', clsx('min-w-32', done && 'bg-ok-bg'))}
      >
        {busy ? <><Spinner /> Uploading</> : done ? 'Uploaded · checking' : doc.status === 'REJECTED' ? 'Upload again' : 'Upload'}
      </button>
    </div>
  );
}

export function PayButton({ slug, invoiceId }: { slug: string; invoiceId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await portalPayAction(slug, invoiceId);
            if (res.ok && res.data) window.location.href = res.data;
            else if (!res.ok) setError(res.error);
          })
        }
        className={buttonCls('primary', 'lg', 'w-full')}
      >
        {pending && <Spinner />} Pay with UPI / card
      </button>
      {error && <span role="alert" className="text-sm text-danger">{error}</span>}
    </div>
  );
}

export function CopyText({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-2">
      <span><span className="text-muted">{label}:</span> <strong>{value}</strong></span>
      <button
        type="button"
        className="text-xs font-semibold underline underline-offset-4"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export function CancelAppointment({ slug, id }: { slug: string; id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-col items-end">
      <button
        type="button"
        disabled={pending}
        className="text-xs font-semibold text-muted underline underline-offset-4 hover:text-ink"
        onClick={() => {
          if (!window.confirm('Cancel this meeting?')) return;
          start(async () => {
            const res = await portalCancelAction(slug, id);
            if (!res.ok) setError(res.error);
            router.refresh();
          });
        }}
      >
        Cancel
      </button>
      {error && <span role="alert" className="text-[11px] text-danger">{error}</span>}
    </span>
  );
}
