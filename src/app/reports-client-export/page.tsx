import React, { Suspense } from 'react';
import AppLayout from '@/components/AppLayout';
import ReportsContent from './components/ReportsContent';

export default function ReportsPage() {
  return (
    <AppLayout>
      <Suspense fallback={null}>
        <ReportsContent />
      </Suspense>
    </AppLayout>
  );
}