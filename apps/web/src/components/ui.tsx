import clsx from 'clsx';
import Link from 'next/link';
import { twMerge } from 'tailwind-merge';
import type { ComponentProps, ReactNode } from 'react';
import type { Tone } from '@/lib/constants';

// Server-safe primitives (no hooks). Styling follows the approved prototype.

type Variant = 'primary' | 'secondary' | 'lime' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const variantCls: Record<Variant, string> = {
  primary: 'bg-ink text-paper hover:bg-ink-2',
  secondary: 'bg-card text-ink shadow-[inset_0_0_0_1px_var(--color-line-2)] hover:shadow-[inset_0_0_0_1px_var(--color-ink)]',
  lime: 'bg-lime text-ink hover:brightness-95',
  ghost: 'text-ink-2 hover:bg-ink/5',
  danger: 'bg-card text-danger shadow-[inset_0_0_0_1px_rgb(180_35_24/0.3)] hover:bg-danger-bg',
};
const sizeCls: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-[9px] gap-1.5',
  md: 'h-10 px-4 text-sm rounded-[11px] gap-2',
  lg: 'h-12 px-5 text-[15px] rounded-[14px] gap-2',
};

export function buttonCls(variant: Variant = 'secondary', size: Size = 'md', extra?: string) {
  return twMerge(
    clsx(
      'inline-flex items-center justify-center font-semibold whitespace-nowrap transition-[background,box-shadow,filter] disabled:opacity-50 disabled:pointer-events-none cursor-pointer',
      variantCls[variant],
      sizeCls[size],
      extra,
    ),
  );
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ComponentProps<'button'> & { variant?: Variant; size?: Size }) {
  return <button type="button" className={buttonCls(variant, size, className)} {...props} />;
}

export function LinkButton({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonCls(variant, size, className)} {...props} />;
}

const toneCls: Record<Tone, string> = {
  neutral: 'bg-paper-2 text-ink-2',
  info: 'bg-info-bg text-info',
  teal: 'bg-teal-bg text-teal',
  warn: 'bg-warn-bg text-warn-ink',
  ok: 'bg-ok-bg text-ok',
  danger: 'bg-danger-bg text-danger',
  lime: 'bg-lime text-ink',
  ink: 'bg-ink text-paper',
};

export function Badge({ tone = 'neutral', className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', toneCls[tone], className)}>
      {children}
    </span>
  );
}

export function Card({ className, children, ...props }: ComponentProps<'section'>) {
  return (
    <section className={clsx('card', className)} {...props}>
      {children}
    </section>
  );
}

export function CardHeader({ title, action, sub }: { title: ReactNode; action?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
      <div className="flex min-w-0 flex-col">
        <h2 className="text-base font-bold tracking-tight">{title}</h2>
        {sub && <span className="text-xs text-muted">{sub}</span>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  sub,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1 className="text-[34px] leading-[1.05] font-extrabold tracking-[-0.04em] sm:text-[40px]">{title}</h1>
        {sub && <div className="text-sm font-medium text-muted">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export const inputCls =
  'h-10 w-full rounded-[11px] bg-card px-3 text-sm text-ink shadow-[inset_0_0_0_1px_var(--color-line-2)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_2px_var(--color-ink)] disabled:bg-paper-3';

export function Field({
  label,
  name,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  name?: string;
  error?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
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

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input id={props.name} className={twMerge(inputCls, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea id={props.name} className={twMerge(inputCls, 'h-auto min-h-24 py-2.5 leading-relaxed', className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select id={props.name} className={twMerge(inputCls, 'appearance-none bg-[url("data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20width%3D%2712%27%20height%3D%2712%27%20fill%3D%27none%27%20stroke%3D%27%235A6069%27%20stroke-width%3D%272%27%3E%3Cpath%20d%3D%27M3%204.5l3%203%203-3%27/%3E%3C/svg%3E")] bg-[position:right_12px_center] bg-no-repeat pr-8', className)} {...props}>
      {children}
    </select>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md px-1.5 py-0.5 font-sans text-[11px] font-semibold text-muted shadow-[inset_0_0_0_1px_var(--color-line-2)]">
      {children}
    </kbd>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-[14px] bg-lime">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
        </svg>
      </div>
      <h3 className="text-base font-bold">{title}</h3>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Avatar({ name, size = 32, tone = 'ink' }: { name: string; size?: number; tone?: 'ink' | 'lime' }) {
  const text = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.38, borderRadius: size * 0.32 }}
      className={clsx('inline-flex shrink-0 items-center justify-center font-extrabold tracking-tight', tone === 'ink' ? 'bg-ink text-lime' : 'bg-lime text-ink')}
    >
      {text || '?'}
    </span>
  );
}

export type SparkTrend = { points: (number | null)[]; labels: string[]; format?: (n: number) => string };

/**
 * Number tile: label, value, an optional 8-week sparkline and a line underneath.
 * The value uses proportional figures (tabular ones look loose at this size).
 */
export function Stat({ label, value, sub, subTone, trend }: { label: string; value: ReactNode; sub?: ReactNode; subTone?: 'warn' | 'ok'; trend?: SparkTrend }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-5 py-4">
      <span className="eyebrow">{label}</span>
      <div className="flex items-end justify-between gap-3">
        <span className="text-[30px] leading-none font-extrabold tracking-[-0.04em] [font-variant-numeric:proportional-nums]">{value}</span>
        {trend && <Sparkline label={label} {...trend} />}
      </div>
      {sub && <span className={clsx('text-xs font-semibold', subTone === 'warn' ? 'text-warn' : subTone === 'ok' ? 'text-ok' : 'text-muted')}>{sub}</span>}
    </div>
  );
}

/**
 * Small trend line: muted line, this week's point in lime with an ink ring.
 * Gaps (no data that week) break the line. Hover a week for its value; screen
 * readers get the whole series.
 */
export function Sparkline({ points, labels, format = String, label, width = 72, height = 26 }: SparkTrend & { label: string; width?: number; height?: number }) {
  const known = points.filter((v): v is number => v !== null);
  if (known.length < 2) return null;
  const pad = 4;
  const min = Math.min(...known);
  const max = Math.max(...known);
  const x = (i: number) => pad + (i * (width - pad * 2)) / (points.length - 1);
  const y = (v: number) => (max === min ? height / 2 : height - pad - ((v - min) * (height - pad * 2)) / (max - min));
  const runs: string[] = [];
  let run: string[] = [];
  points.forEach((v, i) => {
    if (v === null) {
      if (run.length > 1) runs.push(run.join(' '));
      run = [];
    } else run.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (run.length > 1) runs.push(run.join(' '));
  const last = points.at(-1);
  const step = (width - pad * 2) / (points.length - 1);
  const summary = points.map((v, i) => `${labels[i]}: ${v === null ? 'no data' : format(v)}`).join('; ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}, last ${points.length} weeks. ${summary}`} className="shrink-0 overflow-visible">
      {runs.map((r) => <polyline key={r} points={r} fill="none" stroke="var(--color-faint)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />)}
      {last !== null && last !== undefined && <circle cx={x(points.length - 1)} cy={y(last)} r={3.2} fill="var(--color-lime)" stroke="var(--color-ink)" strokeWidth={1.2} />}
      {points.map((v, i) => (
        <rect key={i} x={x(i) - step / 2} y={0} width={step} height={height} fill="transparent">
          <title>{`${labels[i]}: ${v === null ? 'no data' : format(v)}`}</title>
        </rect>
      ))}
    </svg>
  );
}
