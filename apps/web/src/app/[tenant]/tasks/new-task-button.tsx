'use client';

import { Plus } from 'lucide-react';
import { Modal } from '@/components/forms';
import { Button } from '@/components/ui';
import { AppointmentForm, TaskForm } from '../_components/work-panels';

export function NewTaskButton({ slug, team, me }: { slug: string; team: { userId: string; name: string }[]; me: string }) {
  return (
    <Modal title="New task" trigger={(open) => <Button variant="primary" onClick={open}><Plus size={15} /> New task</Button>}>
      {(close) => <TaskForm slug={slug} links={{}} team={team} me={me} onDone={close} />}
    </Modal>
  );
}

export function NewAppointmentButton({
  slug,
  team,
  me,
  tz,
  canOverride,
}: {
  slug: string;
  team: { userId: string; name: string }[];
  me: string;
  tz: string;
  canOverride?: boolean;
}) {
  return (
    <Modal title="Book appointment" trigger={(open) => <Button variant="primary" onClick={open}><Plus size={15} /> Book</Button>}>
      {(close) => <AppointmentForm slug={slug} links={{}} team={team} me={me} tz={tz} canOverride={canOverride} onDone={close} defaultTitle="Meeting" />}
    </Modal>
  );
}
