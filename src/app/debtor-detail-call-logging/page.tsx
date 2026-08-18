import React, { Suspense } from 'react';
import AppLayout from '@/components/AppLayout';
import DebtorDetailContent from './components/DebtorDetailContent';

export default function DebtorDetailPage() {
  return (
    <AppLayout>
      <Suspense fallback={null}>
        <DebtorDetailContent />
      </Suspense>
    </AppLayout>
  );
}