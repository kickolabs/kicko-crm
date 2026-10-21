import Link from 'next/link';
import { buttonCls } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="dotgrid flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="text-[72px] leading-none font-extrabold tracking-[-0.05em]">404</span>
      <p className="max-w-sm text-muted">This page doesn't exist, or you don't have access to it.</p>
      <Link href="/" className={buttonCls('primary', 'md')}>Go home</Link>
    </div>
  );
}
