'use client';

import { useEffect, useRef } from 'react';
import { Plus } from 'lucide-react';
import { Modal } from '@/components/forms';
import { Button } from '@/components/ui';
import type { PackFormProps } from '@/server/library';
import { NewLeadForm, type LeadProduct } from './lead-form';

export function NewLeadButton({
  slug,
  products,
  team,
  autoAssign,
  openInitially,
  form,
}: {
  slug: string;
  products: LeadProduct[];
  form: PackFormProps;
  team: { userId: string; name: string }[];
  autoAssign: boolean;
  openInitially?: boolean;
}) {
  const opener = useRef<() => void>(null);
  useEffect(() => {
    if (openInitially) opener.current?.();
  }, [openInitially]);
  return (
    <Modal
      wide
      title="New lead"
      trigger={(open) => {
        opener.current = open;
        return (
          <Button variant="primary" onClick={open}>
            <Plus size={15} /> New lead
          </Button>
        );
      }}
    >
      {() => <NewLeadForm slug={slug} products={products} team={team} autoAssign={autoAssign} form={form} />}
    </Modal>
  );
}
