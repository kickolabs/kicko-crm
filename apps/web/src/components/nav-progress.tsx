'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * A thin bar at the top that starts the moment an in-app link is clicked and
 * finishes when the new page is on screen, so every click answers at once.
 * (A loading.tsx boundary would do this too, but it stops server-action
 * redirects from completing in Next 15, e.g. "Create lead" → the new lead.)
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // A click on a same-origin link to a different page starts the bar.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      setState('loading');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState('idle'), 15_000); // never stuck
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  // The URL changed: the new page is rendering; finish and fade out.
  useEffect(() => {
    setState((s) => (s === 'loading' ? 'done' : s));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 300);
  }, [pathname, search]);

  if (state === 'idle') return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[3px]">
      <div className={state === 'loading' ? 'nav-progress h-full bg-lime' : 'h-full w-full bg-lime opacity-0 transition-opacity duration-300'} />
    </div>
  );
}
