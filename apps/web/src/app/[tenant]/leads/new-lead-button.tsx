'use client';

import { useEffect, useRef } from 'react';
import { Plus } from 'lucide-react';
import type { VisaProduct } from '@kicko/db';
import { Modal } from '@/components/forms';
import { Button } from '@/components/ui';
import { NewLeadForm } from './lead-form';

export function NewLeadButton({
  slug,
  products,
  team,
  autoAssign,
  openInitially,
}: {
  slug: string;
  products: Pick<VisaProduct, 'id' | 'name' | 'country' | 'category'>[];
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
      {() => <NewLeadForm slug={slug} products={products} team={team} autoAssign={autoAssign} />}
    </Modal>
  );
}
