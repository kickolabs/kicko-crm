'use client';

import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Sparkles } from 'lucide-react';

type Result = { kind: string; id: string; title: string; sub?: string; href: string };

/** Ctrl+K (Windows/Linux) or ⌘K (Mac): label for the current platform. */
function useShortcutLabel() {
  // Default to Ctrl (most users are on Windows); switch after mount to avoid a hydration mismatch.
  const [label, setLabel] = useState('Ctrl K');
  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform = nav.userAgentData?.platform ?? nav.platform ?? '';
    if (/mac|iphone|ipad/i.test(platform)) setLabel('⌘ K');
  }, []);
  return label;
}

/** Command bar: search leads, clients and cases, or jump anywhere. Opens with Ctrl+K or ⌘K. */
export function CommandBar({ slug }: { slug: string }) {
  const router = useRouter();
  const shortcut = useShortcutLabel();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const jumps: Result[] = useMemo(
    () =>
      [
        ['New lead', `/${slug}/leads?new=1`],
        ['Leads', `/${slug}/leads`],
        ['Clients', `/${slug}/clients`],
        ['Cases', `/${slug}/cases`],
        ['My tasks', `/${slug}/tasks`],
        ['Calendar', `/${slug}/calendar`],
        ['Walk-in queue', `/${slug}/walk-ins`],
        ['Settings', `/${slug}/settings`],
      ].map(([title, href]) => ({ kind: 'Go to', id: href!, title: title!, href: href! })),
    [slug],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      }
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/t/${slug}/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal });
        if (res.ok) setResults(await res.json());
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 160);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, slug]);

  const term = q.trim().toLowerCase();
  const items = [...results, ...jumps.filter((j) => !term || j.title.toLowerCase().includes(term))];

  const go = (r: Result) => {
    setOpen(false);
    setQ('');
    router.push(r.href);
  };

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1">
      <label htmlFor="cmdk" className="sr-only">
        Search or jump to
      </label>
      <div
        className={clsx(
          'flex h-11 items-center gap-2.5 rounded-[14px] bg-card px-3.5 transition-shadow',
          open ? 'shadow-[0_0_0_2px_var(--color-ink),0_10px_30px_rgb(18_20_23/0.08)]' : 'shadow-[var(--shadow-card)]',
        )}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-lime">
          <Search size={13} strokeWidth={2.4} aria-hidden="true" />
        </span>
        <input
          ref={inputRef}
          id="cmdk"
          role="combobox"
          aria-expanded={open}
          aria-controls="cmdk-list"
          aria-autocomplete="list"
          autoComplete="off"
          value={q}
          placeholder="Search clients, cases, passport no… or jump anywhere"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && items[active]) {
              e.preventDefault();
              go(items[active]);
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-faint"
        />
        <kbd className="hidden rounded-md px-1.5 py-0.5 font-sans text-[11px] font-semibold text-muted shadow-[inset_0_0_0_1px_var(--color-line-2)] sm:block">
          {shortcut}
        </kbd>
      </div>
      {open && (
        <div
          id="cmdk-list"
          role="listbox"
          className="pop-in absolute top-[calc(100%+8px)] right-0 left-0 z-30 max-h-[60vh] overflow-y-auto rounded-[16px] bg-card p-2 shadow-[var(--shadow-pop)]"
        >
          {loading && results.length === 0 && <div className="px-3 py-2 text-xs text-muted">Searching…</div>}
          {items.length === 0 && !loading && <div className="px-3 py-3 text-sm text-muted">No matches.</div>}
          {items.map((r, i) => (
            <button
              key={`${r.kind}-${r.id}`}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r)}
              className={clsx(
                'flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left',
                i === active ? 'bg-paper-3' : '',
              )}
            >
              <span className="w-14 shrink-0 text-[11px] font-bold tracking-wide text-muted uppercase">{r.kind}</span>
              <span className="min-w-0 flex-1 truncate font-semibold">{r.title}</span>
              {r.sub && <span className="truncate text-xs text-muted">{r.sub}</span>}
            </button>
          ))}
          <div className="mt-1 flex items-center gap-2 border-t border-line px-3 pt-2.5 pb-1 text-xs text-muted">
            <Sparkles size={13} aria-hidden="true" />
            Plain-English commands ("move Priya's case to lodged") arrive with the AI copilot.
          </div>
        </div>
      )}
    </div>
  );
}
