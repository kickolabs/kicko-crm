import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { SecondFactorForm } from '../../auth-forms';

export const metadata = { title: 'Two-step sign-in' };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next: rawNext } = await searchParams;
  const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';
  if (await getSession()) redirect(next);
  return (
    <div className="card pop-in w-full max-w-md p-8">
      <h1 className="text-[32px] leading-tight font-extrabold tracking-[-0.04em]">One more step.</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Enter the 6-digit code from your authenticator app for Kicko.</p>
      <SecondFactorForm next={next} />
      <p className="mt-5 text-center text-sm text-muted">
        <Link href="/login" className="font-semibold text-ink underline underline-offset-4">Back to sign in</Link>
      </p>
    </div>
  );
}
