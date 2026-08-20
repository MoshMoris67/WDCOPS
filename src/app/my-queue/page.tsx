import React, { Suspense } from 'react';
import AppLayout from '@/components/AppLayout';
import AgentQueueContent from '../components/AgentQueueContent';

export default function MyQueuePage() {
  return (
    <AppLayout>
      <Suspense fallback={null}>
        <AgentQueueContent />
      </Suspense>
    </AppLayout>
  );
}
