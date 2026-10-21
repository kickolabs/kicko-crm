'use client';

import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useActionState,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { useFormStatus } from 'react-dom';
import type { ActionResult } from '@/lib/action';
import { buttonCls } from './ui';

const ErrorsCtx = createContext<Record<string, string>>({});

/** Field-level error for the enclosing ActionForm. */
export function useFieldError(name: string) {
  return useContext(ErrorsCtx)[name];
}

/** Labelled field that picks up its error from the enclosing ActionForm. */
export function FormField({
  label,
  name,
  hint,
  className,
  children,
}: {
  label: string;
  name: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const error = useFieldError(name);
  return (
    <div className={clsx('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={name} className="text-[13px] font-semibold text-ink-2">
        {label}
      </label>
      {children}
      {error ? <span className="text-xs font-medium text-danger">{error}</span> : hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

export function FieldError({ name }: { name: string }) {
  const err = useFieldError(name);
  return err ? <span className="text-xs font-medium text-danger">{err}</span> : null;
}

type FormAction = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

/**
 * Form bound to a server action returning ActionResult.
 * Shows errors inline, refreshes data on success, and calls onSuccess.
 */
export function ActionForm({
  action,
  children,
  className,
  onSuccess,
  resetOnSuccess = false,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  onSuccess?: (res: ActionResult) => void;
  resetOnSuccess?: boolean;
}) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(action, null);
  const handled = useRef<ActionResult | null>(null);
  const submitted = useRef<FormData | null>(null);

  // React 19 clears a form after every action, even one that returned a validation
  // error. Put back what the user typed, unless the form should clear on success.
  useLayoutEffect(() => {
    if (!state || !submitted.current || !ref.current) return;
    if (!state.ok || !resetOnSuccess) restoreForm(ref.current, submitted.current);
    submitted.current = null;
  }, [state, resetOnSuccess]);

  useEffect(() => {
    if (!state || handled.current === state) return;
    handled.current = state;
    if (state.ok) {
      if (resetOnSuccess) ref.current?.reset();
      router.refresh();
      onSuccess?.(state);
    }
  }, [state, onSuccess, resetOnSuccess, router]);

  return (
    <ErrorsCtx.Provider value={state && !state.ok ? (state.fieldErrors ?? {}) : {}}>
      <form ref={ref} action={formAction} onSubmit={(e) => (submitted.current = new FormData(e.currentTarget))} className={className} noValidate>
        {state && !state.ok && <FormBanner tone="error">{state.error}</FormBanner>}
        {children}
      </form>
    </ErrorsCtx.Provider>
  );
}

/** Write submitted values back into a form's fields (file inputs can't be restored). */
export function restoreForm(form: HTMLFormElement, data: FormData) {
  for (const el of Array.from(form.elements)) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) || !el.name) continue;
    if (el instanceof HTMLInputElement && (el.type === 'file' || el.type === 'hidden' || el.type === 'submit')) continue;
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      el.checked = data.getAll(el.name).includes(el.value);
      continue;
    }
    const v = data.get(el.name);
    if (typeof v === 'string') el.value = v;
  }
}

export function FormBanner({ tone, children }: { tone: 'error' | 'ok' | 'warn'; children: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={clsx(
        'mb-3 rounded-[12px] px-3.5 py-2.5 text-[13px] font-medium',
        tone === 'error' && 'bg-danger-bg text-danger',
        tone === 'ok' && 'bg-ok-bg text-ok',
        tone === 'warn' && 'bg-warn-bg text-warn-ink',
      )}
    >
      {children}
    </div>
  );
}

export function SubmitButton({
  children,
  variant = 'primary',
  size = 'md',
  className,
  name,
  value,
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'lime' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={buttonCls(variant, size, className)}>
      {pending ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Native <dialog> modal with a trigger button. */
export function Modal({
  trigger,
  title,
  children,
  wide,
}: {
  trigger: (open: () => void) => ReactNode;
  title: string;
  children: (close: () => void) => ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(false);
  const open = () => {
    setMounted(true);
    requestAnimationFrame(() => ref.current?.showModal());
  };
  const close = () => {
    ref.current?.close();
    setMounted(false);
  };
  return (
    <>
      {trigger(open)}
      <dialog
        ref={ref}
        onClose={() => setMounted(false)}
        onClick={(e) => e.target === ref.current && close()}
        className={clsx(
          'pop-in m-auto w-[calc(100%-32px)] rounded-[22px] bg-card p-0 text-ink shadow-[var(--shadow-pop)]',
          wide ? 'max-w-3xl' : 'max-w-lg',
        )}
      >
        {mounted && (
          <div className="flex max-h-[85vh] flex-col">
            <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
              <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
              <button type="button" onClick={close} aria-label="Close" className={buttonCls('ghost', 'sm', 'w-8 px-0')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto px-6 py-5">{children(close)}</div>
          </div>
        )}
      </dialog>
    </>
  );
}

/** Small button that runs a server action without a form (status toggles etc). */
export function ActionButton({
  action,
  children,
  variant = 'secondary',
  size = 'sm',
  className,
  confirm,
  title,
}: {
  action: () => Promise<ActionResult>;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'lime' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  className?: string;
  confirm?: string;
  title?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        title={title}
        aria-label={title}
        disabled={pending}
        className={buttonCls(variant, size, className)}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            const res = await action();
            if (res.ok) {
              setError(null);
              router.refresh();
            } else setError(res.error);
          });
        }}
      >
        {pending && <Spinner />}
        {children}
      </button>
      {error && <span role="alert" className="text-xs font-medium text-danger">{error}</span>}
    </span>
  );
}

export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        aria-label={label}
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className="h-10 min-w-0 flex-1 rounded-[11px] bg-paper-3 px-3 text-[13px] text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] outline-none"
      />
      <button
        type="button"
        className={buttonCls('secondary', 'md')}
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
