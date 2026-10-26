'use client';

import { Plus } from 'lucide-react';
import { Modal } from '@/components/forms';
import { Button } from '@/components/ui';
import { OpeningForm, OrganizationForm } from './org-forms';

export function NewOrganizationButton({ slug, countries, word }: { slug: string; countries: { key: string; name: string }[]; word: string }) {
  return (
    <Modal wide title={`New ${word.toLowerCase()}`} trigger={(open) => <Button variant="primary" onClick={open}><Plus size={15} /> New {word.toLowerCase()}</Button>}>
      {() => <OrganizationForm slug={slug} countries={countries} word={word} />}
    </Modal>
  );
}

export function NewOpeningButton(props: Omit<React.ComponentProps<typeof OpeningForm>, 'opening'>) {
  return (
    <Modal wide title={`New ${props.word.toLowerCase()}`} trigger={(open) => <Button variant="primary" onClick={open}><Plus size={15} /> New {props.word.toLowerCase()}</Button>}>
      {() => <OpeningForm {...props} />}
    </Modal>
  );
}
