import React, { Suspense } from 'react';
import AppLayout from '@/components/AppLayout';
import AgentDashboardContent from '../components/AgentDashboardContent';

export default function AgentDashboardPage() {
  return (
    <AppLayout>
      <Suspense fallback={null}>
        <AgentDashboardContent />
      </Suspense>
    </AppLayout>
  );
}