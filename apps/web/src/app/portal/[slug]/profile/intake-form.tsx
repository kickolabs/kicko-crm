'use client';

import { useState } from 'react';
import type { PackField } from '@kicko/packs';
import { ActionForm, FormBanner, SubmitButton } from '@/components/forms';
import { PackFields, type Lookups } from '@/components/pack-fields';
import type { PackValues } from '@/lib/pack-fields';
import { portalIntakeAction } from '../actions';

const SAVE: Record<string, string> = { en: 'Send answers', hi: 'उत्तर भेजें', ta: 'பதில்களை அனுப்பு', ml: 'ഉത്തരങ്ങൾ അയയ്ക്കുക', te: 'సమాధానాలు పంపండి', pa: 'ਜਵਾਬ ਭੇਜੋ', gu: 'જવાબો મોકલો', bn: 'উত্তর পাঠান', ar: 'إرسال الإجابات' };

export function IntakeForm({ slug, lang, fields, values, lookups, groupLabels }: { slug: string; lang: string; fields: PackField[]; values: PackValues; lookups: Lookups; groupLabels: Record<string, Record<string, string>> }) {
  const [done, setDone] = useState(false);
  if (done) return <FormBanner tone="ok">Thank you! Your consultant can see your answers now.</FormBanner>;
  return (
    <ActionForm action={portalIntakeAction.bind(null, slug)} onSuccess={() => setDone(true)} className="card flex flex-col gap-5 p-6">
      <div lang={lang} dir={lang === 'ar' ? 'rtl' : undefined} className="grid gap-4 sm:grid-cols-2">
        <PackFields fields={fields.map((f) => ({ ...f, section: undefined }))} values={values} lookups={lookups} groupLabels={groupLabels} />
      </div>
      <div><SubmitButton size="lg">{SAVE[lang] ?? SAVE.en}</SubmitButton></div>
    </ActionForm>
  );
}
