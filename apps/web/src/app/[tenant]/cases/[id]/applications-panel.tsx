'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { GraduationCap, Plus } from 'lucide-react';
import type { ApplicationStatus } from '@kicko/db';
import { ActionForm, FormField, Modal, SubmitButton } from '@/components/forms';
import { Button, Input, Select } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { addApplicationAction, setApplicationStatusAction } from '../../actions-phase2';

export type AppRow = {
  id: string;
  institution: { id: string; name: string; country: string };
  courseName: string;
  intake: string | null;
  status: ApplicationStatus;
  tuitionFee: number | null;
  currency: string;
  studentId: string | null;
  claim: { amount: number; currency: string; status: string } | null;
};

export type InstitutionOpt = {
  id: string;
  name: string;
  country: string;
  courses: { id: string; name: string; level: string | null; intakes: string | null; tuitionFee: number | null }[];
};

const LABEL: Record<ApplicationStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  CONDITIONAL_OFFER: 'Conditional offer',
  UNCONDITIONAL_OFFER: 'Unconditional offer',
  REJECTED: 'Rejected',
  ACCEPTED: 'Offer accepted',
  ENROLLED: 'Enrolled',
  WITHDRAWN: 'Withdrawn',
};
const TONE: Partial<Record<ApplicationStatus, string>> = {
  CONDITIONAL_OFFER: 'bg-info-bg text-info',
  UNCONDITIONAL_OFFER: 'bg-teal-bg text-teal',
  ACCEPTED: 'bg-teal-bg text-teal',
  ENROLLED: 'bg-lime text-ink',
  REJECTED: 'bg-danger-bg text-danger',
  WITHDRAWN: 'bg-paper-2 text-muted',
};

export function ApplicationsPanel({
  slug,
  caseId,
  apps,
  institutions,
  canWrite,
  country,
}: {
  slug: string;
  caseId: string;
  apps: AppRow[];
  institutions: InstitutionOpt[];
  canWrite: boolean;
  country: string;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <section className="card" aria-label="Applications">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <div className="flex flex-col">
          <h2 className="text-base font-bold">Applications</h2>
          <span className="text-xs text-muted">Institutions applied to. Marking one Enrolled raises the commission claim.</span>
        </div>
        {canWrite && <AddApplication slug={slug} caseId={caseId} institutions={institutions} country={country} />}
      </div>
      {err && <p role="alert" className="mx-5 mt-3 rounded-[10px] bg-danger-bg px-3 py-2 text-sm text-danger">{err}</p>}
      <ul className="divide-y divide-line">
        {apps.length === 0 && <li className="px-5 py-5 text-sm text-muted">No applications yet.</li>}
        {apps.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-paper-2"><GraduationCap size={16} aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <Link href={`/${slug}/partners/${a.institution.id}`} className="text-sm font-bold hover:underline">{a.institution.name}</Link>
              <div className="text-xs text-muted">
                {a.courseName}
                {a.intake && ` · ${a.intake}`}
                {a.tuitionFee != null && ` · ${formatMoney(a.tuitionFee, a.currency)}/yr`}
                {a.studentId && ` · ID ${a.studentId}`}
              </div>
              {a.claim && (
                <div className="mt-1 text-[11px] font-semibold text-olive">
                  Commission {formatMoney(a.claim.amount, a.claim.currency)} · {a.claim.status.toLowerCase().replace('_', ' ')}
                </div>
              )}
            </div>
            {canWrite ? (
              <Select
                aria-label={`Status for ${a.institution.name}`}
                value={a.status}
                className={clsx('h-8 w-48 text-xs font-bold', TONE[a.status])}
                onChange={(e) =>
                  start(async () => {
                    const res = await setApplicationStatusAction(slug, a.id, e.target.value as ApplicationStatus);
                    setErr(res.ok ? null : res.error);
                    router.refresh();
                  })
                }
              >
                {Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            ) : (
              <span className={clsx('rounded-full px-2.5 py-0.5 text-xs font-bold', TONE[a.status] ?? 'bg-paper-2')}>{LABEL[a.status]}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AddApplication({ slug, caseId, institutions, country }: { slug: string; caseId: string; institutions: InstitutionOpt[]; country: string }) {
  const sorted = [...institutions].sort((a, b) => Number(b.country === country) - Number(a.country === country));
  const [instId, setInstId] = useState(sorted[0]?.id ?? '');
  const [courseId, setCourseId] = useState('');
  const inst = institutions.find((i) => i.id === instId);
  const course = inst?.courses.find((c) => c.id === courseId);
  return (
    <Modal title="Add application" trigger={(open) => <Button size="sm" onClick={open}><Plus size={14} /> Application</Button>}>
      {(close) =>
        institutions.length === 0 ? (
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted">Add your partner institutions first.</p>
            <Link href={`/${slug}/partners/new`} className="font-semibold underline underline-offset-4">Add an institution →</Link>
          </div>
        ) : (
          <ActionForm action={addApplicationAction.bind(null, slug, caseId)} onSuccess={close} className="flex flex-col gap-3.5">
            <FormField label="Institution" name="institutionId">
              <Select name="institutionId" value={instId} onChange={(e) => { setInstId(e.target.value); setCourseId(''); }}>
                {sorted.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.country})</option>)}
              </Select>
            </FormField>
            <FormField label="Course" name="courseId">
              <Select name="courseId" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                <option value="">Not in the list (type below)</option>
                {inst?.courses.map((c) => <option key={c.id} value={c.id}>{c.name}{c.level ? ` · ${c.level}` : ''}</option>)}
              </Select>
            </FormField>
            {!courseId && (
              <FormField label="Course name" name="courseName"><Input name="courseName" placeholder="e.g. PG Diploma in Data Analytics" /></FormField>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField label="Intake" name="intake" hint={course?.intakes ? `Offered: ${course.intakes}` : undefined}>
                <Input name="intake" placeholder="Jan 2027" />
              </FormField>
              <FormField label="1st-year tuition" name="tuitionFee">
                <Input name="tuitionFee" inputMode="decimal" key={courseId} defaultValue={course?.tuitionFee != null ? String(course.tuitionFee / 100) : ''} />
              </FormField>
              <FormField label="Student ID" name="studentId"><Input name="studentId" /></FormField>
            </div>
            <div className="flex justify-end"><SubmitButton>Add application</SubmitButton></div>
          </ActionForm>
        )
      }
    </Modal>
  );
}
