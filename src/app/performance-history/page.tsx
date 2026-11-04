import React, { Suspense } from 'react';
import AppLayout from '@/components/AppLayout';
import PerformanceHistoryContent from './components/PerformanceHistoryContent';

export default function PerformanceHistoryPage() {
  return (
    <AppLayout>
      <Suspense fallback={null}>
        <PerformanceHistoryContent />
      </Suspense>
    </AppLayout>
  );
}
