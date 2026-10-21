import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { SignInForm } from '../auth-forms';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next: rawNext } = await searchParams;
  const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : undefined;
  if (await getSession()) redirect(next ?? '/');
  return (
    <div className="card pop-in w-full max-w-md p-8">
      <h1 className="text-[32px] leading-tight font-extrabold tracking-[-0.04em]">Welcome back.</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Sign in to your agency workspace.</p>
      <SignInForm next={next} />
    </div>
  );
}
