'use client';

import clsx from 'clsx';
import { ChevronDown, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { inputCls } from '@/components/ui';

// A searchable select for long lists (199 countries, 124 occupations): type to filter,
// arrows + Enter to pick, Esc to close. Submits like a <select> through a hidden input.
// Matches the start of words first, then anywhere, and also the option's `search` words
// (e.g. "UAE", "Dubai" for the United Arab Emirates; "HGV driver" for truck driver).

export type ComboOption = { key: string; name: string; group?: string; search?: string };

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function rank(o: ComboOption, q: string) {
  const name = fold(o.name);
  if (name.startsWith(q)) return 0;
  if (name.split(/[\s(,/-]+/).some((w) => w.startsWith(q))) return 1;
  const extra = fold(o.search ?? '');
  if (extra.split(/\s*[|,]\s*|\s+/).some((w) => w && w.startsWith(q)) || fold(o.key) === q) return 2;
  if (name.includes(q) || extra.includes(q)) return 3;
  return -1;
}

export function Combobox({
  name,
  id,
  options,
  value,
  defaultValue,
  onChange,
  placeholder = 'Type to search',
  groupOrder,
  emptyLabel,
  disabled,
  clearOnSelect,
  'aria-label': ariaLabel,
}: {
  /** Form field name; omit for a picker that only calls onChange (e.g. "add to list"). */
  name?: string;
  id?: string;
  options: ComboOption[];
  /** Controlled value (option key, '' = none). */
  value?: string;
  defaultValue?: string;
  onChange?: (key: string) => void;
  placeholder?: string;
  /** Groups shown in this order first (e.g. "Your destinations"); the rest A–Z. */
  groupOrder?: string[];
  /** A first option meaning "none" (e.g. "Any", "Not set"). */
  emptyLabel?: string;
  disabled?: boolean;
  /** For "Add…" pickers: clear the box after a pick. */
  clearOnSelect?: boolean;
  'aria-label'?: string;
}) {
  const [inner, setInner] = useState(defaultValue ?? '');
  const current = value ?? inner;
  const selected = options.find((o) => o.key === current);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const shown = useMemo(() => {
    const q = fold(query.trim());
    const order = (g?: string) => {
      const i = groupOrder?.indexOf(g ?? '') ?? -1;
      return i >= 0 ? i : (groupOrder?.length ?? 0) + 1;
    };
    if (!q) {
      return [...options].sort((a, b) => order(a.group) - order(b.group) || (a.group ?? '').localeCompare(b.group ?? '') || a.name.localeCompare(b.name));
    }
    return options
      .map((o) => ({ o, r: rank(o, q) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r || a.o.name.localeCompare(b.o.name))
      .map((x) => x.o);
  }, [options, query, groupOrder]);
  const items: (ComboOption | null)[] = emptyLabel && !query ? [null, ...shown] : shown;
  const grouped = !query && shown.some((o) => o.group);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && (setOpen(false), setQuery(''));
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index='${active}']`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const pick = (o: ComboOption | null) => {
    const key = o?.key ?? '';
    if (!clearOnSelect) setInner(key);
    onChange?.(key);
    setQuery('');
    setOpen(false);
    if (clearOnSelect) input.current?.focus();
  };
  const optionId = (i: number) => `${listId}-o${i}`;

  return (
    <div ref={box} className="relative">
      {name && <input type="hidden" name={name} value={current} />}
      <input
        ref={input}
        id={id ?? name}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && items.length ? optionId(active) : undefined}
        autoComplete="off"
        disabled={disabled}
        placeholder={selected && !clearOnSelect ? selected.name : placeholder}
        value={open ? query : clearOnSelect ? '' : (selected?.name ?? '')}
        onFocus={() => {
          setOpen(true);
          setActive(Math.max(0, items.findIndex((o) => o?.key === current)));
        }}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, items.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && open) {
            e.preventDefault();
            if (items.length) pick(items[active] ?? null);
          } else if (e.key === 'Escape') {
            setOpen(false);
            setQuery('');
          } else if (e.key === 'Tab') {
            setOpen(false);
            setQuery('');
          }
        }}
        className={clsx(inputCls, 'pr-16')}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted">
        <ChevronDown size={15} />
      </span>
      {current && !clearOnSelect && !disabled && (
        <button type="button" onClick={() => pick(null)} aria-label="Clear" className="absolute inset-y-0 right-8 my-auto grid size-6 place-items-center rounded-full text-muted hover:bg-paper-2 hover:text-ink">
          <X size={13} />
        </button>
      )}
      {open && (
        <ul ref={list} id={listId} role="listbox" className="absolute z-40 mt-1.5 max-h-72 w-full overflow-y-auto rounded-[14px] bg-card py-1.5 shadow-[var(--shadow-pop)]">
          {items.length === 0 && <li className="px-3.5 py-2.5 text-sm text-muted">No match for “{query}”</li>}
          {items.map((o, i) => {
            const head = grouped && o && o.group && o.group !== items[i - 1]?.group ? o.group : null;
            return (
              <li key={o?.key ?? '__none'} role="presentation">
                {head && <div className="eyebrow px-3.5 pt-2.5 pb-1">{head}</div>}
                <div
                  id={optionId(i)}
                  data-index={i}
                  role="option"
                  aria-selected={(o?.key ?? '') === current}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(o)}
                  className={clsx(
                    'mx-1.5 cursor-pointer rounded-[9px] px-2.5 py-1.5 text-sm',
                    i === active ? 'bg-paper-2' : '',
                    (o?.key ?? '') === current && 'font-semibold',
                    !o && 'text-muted',
                  )}
                >
                  {o ? o.name : emptyLabel}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
