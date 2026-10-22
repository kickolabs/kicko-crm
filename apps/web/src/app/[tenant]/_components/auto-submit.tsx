'use client';

import type { ComponentProps } from 'react';
import { Select } from '@/components/ui';

/** A filter select that submits its form on change (the form also has a button, so it works without JS). */
export function AutoSubmitSelect(props: ComponentProps<'select'>) {
  return <Select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
