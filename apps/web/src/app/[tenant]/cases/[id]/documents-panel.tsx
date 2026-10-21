'use client';

import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Ban, Eye, FileText, Plus, RotateCcw, Sparkles, Upload } from 'lucide-react';
import type { DocumentStatus } from '@kicko/db';
import { ActionForm, FormField, Modal, SubmitButton, Spinner } from '@/components/forms';
import { Button, Input, Textarea, buttonCls } from '@/components/ui';
import {
  fileUrlAction,
  finishUploadAction,
  requestDocumentAction,
  reviewDocumentAction,
  setDocumentStatusAction,
  startUploadAction,
} from '../../actions-phase2';
import { recheckDocumentAction } from '../../actions-phase5';

export type DocRow = {
  id: string;
  name: string;
  group: string;
  required: boolean;
  status: DocumentStatus;
  rejectionReason: string | null;
  expiresAt: string | null;
  files: { id: string; fileName: string; contentType: string; size: number; createdAt: string; ai: AiView | null }[];
};

/** AI document check on one file (see server/ai/doc-check.ts). */
export type AiView = {
  status: string | null; // pending | done | failed | skipped
  documentType?: string;
  issues?: { severity: 'high' | 'medium' | 'low'; message: string }[];
  fields?: { fullName: string | null; dateOfBirth: string | null; documentNumber: string | null; expiryDate: string | null; issuingCountry: string | null };
  sandbox?: boolean;
  reason?: string;
};

function AiChip({ ai }: { ai: AiView | null | undefined }) {
  if (!ai?.status) return null;
  if (ai.status === 'pending') return <span className="inline-flex items-center gap-1 text-muted"><Sparkles size={11} /> AI checking…</span>;
  if (ai.status !== 'done') return <span className="inline-flex items-center gap-1 text-muted"><Sparkles size={11} /> AI: not checked</span>;
  const serious = (ai.issues ?? []).filter((i) => i.severity !== 'low');
  return serious.length ? (
    <span className={clsx('inline-flex items-center gap-1 font-semibold', serious.some((i) => i.severity === 'high') ? 'text-danger' : 'text-warn')}>
      <Sparkles size={11} /> AI: {serious.length} issue{serious.length > 1 ? 's' : ''} · {serious[0]!.message}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 font-semibold text-ok"><Sparkles size={11} /> AI: looks right</span>
  );
}

const STATUS: Record<DocumentStatus, { label: string; dot: string; chip: string }> = {
  PENDING: { label: 'Pending', dot: 'bg-[#B9BCC0]', chip: 'bg-paper-2 text-ink-2' },
  UPLOADED: { label: 'To review', dot: 'bg-[#6B9BEA]', chip: 'bg-info-bg text-info' },
  VERIFIED: { label: 'Verified', dot: 'bg-[#6FA82A]', chip: 'bg-ok-bg text-ok' },
  REJECTED: { label: 'Rejected', dot: 'bg-[#E8862A]', chip: 'bg-warn-bg text-warn-ink' },
  NOT_APPLICABLE: { label: 'N/A', dot: 'bg-transparent ring-1 ring-[#B9BCC0]', chip: 'bg-paper-2 text-muted' },
};

const EXT_TYPES: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function DocumentsPanel({
  slug,
  caseId,
  docs,
  canWrite,
  canVerify,
}: {
  slug: string;
  caseId: string;
  docs: DocRow[];
  canWrite: boolean;
  canVerify: boolean;
}) {
  // AI checks run in the background after an upload: refresh until they finish.
  const router = useRouter();
  const checking = docs.some((d) => d.files[0]?.ai?.status === 'pending');
  useEffect(() => {
    if (!checking) return;
    const id = setInterval(() => router.refresh(), 2000);
    const stop = setTimeout(() => clearInterval(id), 60_000);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [checking, router]);
  const relevant = docs.filter((d) => d.status !== 'NOT_APPLICABLE');
  const required = relevant.filter((d) => d.required);
  const verified = required.filter((d) => d.status === 'VERIFIED').length;
  const toReview = docs.filter((d) => d.status === 'UPLOADED').length;
  const groups = [...new Set(docs.map((d) => d.group))];
  const pct = required.length ? Math.round((verified / required.length) * 100) : 0;

  return (
    <section className="card" aria-label="Documents">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-base font-bold">Documents</h2>
          <span className="text-xs text-muted">
            {verified}/{required.length} required verified
            {toReview > 0 && <span className="ml-2 rounded-full bg-info-bg px-2 py-0.5 font-bold text-info">{toReview} to review</span>}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="h-2 w-32 rounded-full bg-paper-2" aria-label={`${pct}% verified`}>
            <div className="h-2 rounded-full bg-ink" style={{ width: `${pct}%` }} />
          </div>
          {canWrite && <RequestDoc slug={slug} caseId={caseId} />}
        </div>
      </div>
      <div className="flex flex-col">
        {groups.map((g) => (
          <div key={g} className="border-b border-line last:border-0">
            <div className="eyebrow px-5 pt-3.5 pb-1">{g}</div>
            <ul>
              {docs.filter((d) => d.group === g).map((d) => (
                <DocItem key={d.id} slug={slug} doc={d} canWrite={canWrite} canVerify={canVerify} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function DocItem({ slug, doc, canWrite, canVerify }: { slug: string; doc: DocRow; canWrite: boolean; canVerify: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const s = STATUS[doc.status];
  const current = doc.files[0];
  const expired = doc.expiresAt && new Date(doc.expiresAt) < new Date();
  const expiringSoon = doc.expiresAt && !expired && new Date(doc.expiresAt).getTime() < Date.now() + 60 * 86400_000;

  async function upload(file: File) {
    setError(null);
    const contentType = file.type || EXT_TYPES[file.name.split('.').pop()?.toLowerCase() ?? ''] || '';
    setBusy('Uploading…');
    const started = await startUploadAction(slug, doc.id, { fileName: file.name, contentType, size: file.size });
    if (!started.ok || !started.data) {
      setBusy(null);
      return setError(started.ok ? 'Upload failed' : started.error);
    }
    const put = await fetch(started.data.url, { method: 'PUT', headers: started.data.headers, body: file }).catch(() => null);
    if (!put?.ok) {
      setBusy(null);
      return setError('Upload failed. Check your connection and try again.');
    }
    const done = await finishUploadAction(slug, doc.id, { key: started.data.key, fileName: file.name, contentType, size: file.size });
    setBusy(null);
    if (!done.ok) return setError(done.error);
    start(() => router.refresh());
  }

  return (
    <li className={clsx('flex flex-wrap items-center gap-3 px-5 py-2.5', doc.status === 'UPLOADED' && 'bg-info-bg/40', doc.status === 'REJECTED' && 'bg-warn-bg/50')}>
      <span className={clsx('h-2.5 w-2.5 shrink-0 rounded-full', s.dot)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className={clsx('text-[13px] font-semibold', doc.status === 'NOT_APPLICABLE' && 'text-faint line-through')}>
          {doc.name}
          {!doc.required && <span className="ml-1.5 text-[11px] font-medium text-muted">optional</span>}
        </div>
        <div className="flex flex-wrap gap-x-2 text-[11px] text-muted">
          {current && (
            <span className="truncate">
              {current.fileName} · {kb(current.size)}
              {doc.files.length > 1 && ` · v${doc.files.length}`}
            </span>
          )}
          {doc.status !== 'VERIFIED' && <AiChip ai={current?.ai} />}
          {doc.status === 'REJECTED' && doc.rejectionReason && <span className="font-semibold text-warn-ink">Fix: {doc.rejectionReason}</span>}
          {doc.expiresAt && (
            <span className={clsx(expired ? 'font-bold text-danger' : expiringSoon ? 'font-semibold text-warn' : '')}>
              {expired ? 'Expired' : 'Expires'} {new Date(doc.expiresAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })}
            </span>
          )}
          {error && <span role="alert" className="font-semibold text-danger">{error}</span>}
        </div>
      </div>
      <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-bold', s.chip)}>{s.label}</span>
      <div className="flex items-center gap-1">
        {busy ? (
          <span className="flex items-center gap-1.5 px-2 text-xs font-semibold text-muted"><Spinner /> {busy}</span>
        ) : (
          <>
            {current && (
              <ReviewModal slug={slug} doc={doc} canVerify={canVerify && doc.status !== 'NOT_APPLICABLE'} />
            )}
            {canWrite && doc.status !== 'VERIFIED' && doc.status !== 'NOT_APPLICABLE' && (
              <>
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
                <button type="button" onClick={() => input.current?.click()} className={buttonCls(current ? 'ghost' : 'secondary', 'sm')}>
                  <Upload size={13} /> {current ? 'Replace' : 'Upload'}
                </button>
              </>
            )}
            {canWrite && !current && doc.status !== 'NOT_APPLICABLE' && (
              <button type="button" title="Not applicable" aria-label={`Mark ${doc.name} not applicable`} onClick={() => start(async () => { await setDocumentStatusAction(slug, doc.id, 'NOT_APPLICABLE'); router.refresh(); })} className={buttonCls('ghost', 'sm', 'w-8 px-0')}>
                <Ban size={13} />
              </button>
            )}
            {canWrite && doc.status === 'NOT_APPLICABLE' && (
              <button type="button" title="Restore" aria-label={`Restore ${doc.name}`} onClick={() => start(async () => { await setDocumentStatusAction(slug, doc.id, 'PENDING'); router.refresh(); })} className={buttonCls('ghost', 'sm', 'w-8 px-0')}>
                <RotateCcw size={13} />
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

function ReviewModal({ slug, doc, canVerify }: { slug: string; doc: DocRow; canVerify: boolean }) {
  const [fileId, setFileId] = useState(doc.files[0]!.id);
  const [url, setUrl] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [expiry, setExpiry] = useState(doc.expiresAt?.slice(0, 10) ?? '');
  const [rechecking, startRecheck] = useTransition();
  const router = useRouter();
  const file = doc.files.find((f) => f.id === fileId) ?? doc.files[0]!;
  const ai = file.ai;

  async function load(id: string) {
    setUrl(null);
    const res = await fileUrlAction(slug, id, true);
    if (res.ok && res.data) setUrl(res.data);
  }

  return (
    <Modal
      wide
      title={doc.name}
      trigger={(open) => (
        <Button
          size="sm"
          variant={doc.status === 'UPLOADED' && canVerify ? 'primary' : 'ghost'}
          onClick={() => {
            open();
            void load(fileId);
          }}
        >
          <Eye size={13} /> {doc.status === 'UPLOADED' && canVerify ? 'Review' : 'View'}
        </Button>
      )}
    >
      {(close) => (
        <div className="flex flex-col gap-4">
          {doc.files.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Versions">
              {doc.files.map((f, i) => (
                <button key={f.id} type="button" role="tab" aria-selected={f.id === fileId} onClick={() => { setFileId(f.id); void load(f.id); }} className={clsx('rounded-full px-3 py-1 text-xs font-semibold', f.id === fileId ? 'bg-ink text-paper' : 'bg-paper-2 text-ink-2')}>
                  v{doc.files.length - i} · {new Date(f.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                </button>
              ))}
            </div>
          )}
          <div className="flex h-[55vh] items-center justify-center overflow-hidden rounded-[14px] bg-paper-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
            {!url ? (
              <Spinner />
            ) : file.contentType === 'application/pdf' ? (
              <iframe src={url} title={file.fileName} className="h-full w-full" />
            ) : file.contentType.startsWith('image/') && file.contentType !== 'image/heic' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={doc.name} className="max-h-full max-w-full object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-3 text-sm text-muted">
                <FileText size={28} />
                No preview for this file type.
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>{file.fileName} · {kb(file.size)}</span>
            <button
              type="button"
              className="font-semibold text-ink underline underline-offset-4"
              onClick={async () => {
                const r = await fileUrlAction(slug, file.id, false);
                if (r.ok && r.data) window.location.href = r.data;
              }}
            >
              Download
            </button>
          </div>
          {ai?.status && (
            <section aria-label="AI check" className="flex flex-col gap-2 rounded-[14px] p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
              <div className="flex flex-wrap items-center gap-2">
                <Sparkles size={14} />
                <span className="text-sm font-bold">AI check</span>
                {ai.status === 'done' && ai.documentType && <span className="text-xs text-muted">Looks like: {ai.documentType}</span>}
                <button type="button" disabled={rechecking} onClick={() => startRecheck(async () => { await recheckDocumentAction(slug, file.id); router.refresh(); })} className="ml-auto text-xs font-semibold text-ink underline underline-offset-4">
                  {rechecking ? 'Checking…' : 'Check again'}
                </button>
              </div>
              {ai.status === 'pending' && <p className="text-xs text-muted">Reading the document…</p>}
              {ai.status !== 'done' && ai.status !== 'pending' && <p className="text-xs text-muted">{ai.reason ?? 'Not checked.'}</p>}
              {ai.status === 'done' && (
                <>
                  {(ai.issues ?? []).length === 0 ? (
                    <p className="text-sm text-ok">No problems found.</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {ai.issues!.map((i) => (
                        <li key={i.message} className={clsx('text-sm', i.severity === 'high' ? 'font-semibold text-danger' : i.severity === 'medium' ? 'text-warn-ink' : 'text-ink-2')}>{i.message}</li>
                      ))}
                    </ul>
                  )}
                  {ai.fields && Object.values(ai.fields).some(Boolean) && (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                      {([['Name', ai.fields.fullName], ['Date of birth', ai.fields.dateOfBirth], ['Number', ai.fields.documentNumber], ['Expiry', ai.fields.expiryDate], ['Country', ai.fields.issuingCountry]] as const)
                        .filter(([, v]) => v)
                        .map(([k, v]) => (
                          <div key={k}><dt className="text-muted">{k}</dt><dd className="font-semibold">{v}</dd></div>
                        ))}
                    </dl>
                  )}
                  <p className="text-[11px] text-muted">{ai.sandbox ? 'Sandbox: judged from the file name and size only. Add an Anthropic API key to read the document itself.' : 'Read by AI. It can be wrong, so check before verifying.'}</p>
                </>
              )}
            </section>
          )}
          {canVerify && (
            <ActionForm action={reviewDocumentAction.bind(null, slug, doc.id)} onSuccess={close} className="flex flex-col gap-3 rounded-[14px] bg-paper-3 p-4">
              <input type="hidden" name="decision" value={rejecting ? 'REJECTED' : 'VERIFIED'} />
              {rejecting ? (
                <FormField label="What needs fixing? (the client will see this)" name="reason">
                  <Textarea name="reason" className="min-h-16" placeholder="e.g. Last page missing; upload all pages of the passport" autoFocus />
                </FormField>
              ) : (
                <FormField label="Expiry date (optional)" name="expiresAt" hint="Passports, test scores, police and medical certificates expire; we'll remind you.">
                  <span className="flex flex-wrap items-center gap-2">
                    <Input name="expiresAt" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="w-48" />
                    {ai?.fields?.expiryDate && ai.fields.expiryDate !== expiry && /^d{4}-d{2}-d{2}$/.test(ai.fields.expiryDate) && (
                      <Button size="sm" variant="ghost" onClick={() => setExpiry(ai.fields!.expiryDate!)}>Use {ai.fields.expiryDate} (from AI)</Button>
                    )}
                  </span>
                </FormField>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="md" variant={rejecting ? 'ghost' : 'danger'} onClick={() => setRejecting((r) => !r)}>
                  {rejecting ? 'Cancel' : 'Reject'}
                </Button>
                <SubmitButton variant={rejecting ? 'danger' : 'primary'}>{rejecting ? 'Reject & ask again' : 'Verify'}</SubmitButton>
              </div>
            </ActionForm>
          )}
        </div>
      )}
    </Modal>
  );
}

function RequestDoc({ slug, caseId }: { slug: string; caseId: string }) {
  return (
    <Modal title="Request a document" trigger={(open) => <Button size="sm" onClick={open}><Plus size={14} /> Request</Button>}>
      {(close) => (
        <ActionForm action={requestDocumentAction.bind(null, slug, caseId)} onSuccess={close} className="flex flex-col gap-3.5">
          <FormField label="Document" name="name"><Input name="name" placeholder="e.g. Study gap explanation letter" required autoFocus /></FormField>
          <FormField label="Group" name="group"><Input name="group" placeholder="Additional" /></FormField>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="required" defaultChecked className="h-4 w-4 accent-[#121417]" /> Required
          </label>
          <div className="flex justify-end"><SubmitButton>Add to checklist</SubmitButton></div>
        </ActionForm>
      )}
    </Modal>
  );
}
