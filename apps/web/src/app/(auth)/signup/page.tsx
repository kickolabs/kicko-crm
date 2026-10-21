import { getSession } from '@/lib/auth';
import { SignUpForm } from '../auth-forms';

export const metadata = { title: 'Create your workspace' };

export default async function SignupPage() {
  const session = await getSession();
  return (
    <div className="card pop-in w-full max-w-xl p-8">
      <span className="eyebrow">Kicko for consultancies</span>
      <h1 className="mt-2 text-[32px] leading-tight font-extrabold tracking-[-0.04em]">
        {session ? 'Add another agency.' : 'Set up your agency in a minute.'}
      </h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        {session
          ? `Signed in as ${session.user.email}. You'll be the owner of the new workspace.`
          : 'Comes with 25+ ready visa workflows across study, PR, work, visit and family. Edit them anytime.'}
      </p>
      <SignUpForm signedInAs={session?.user.email} />
    </div>
  );
}
