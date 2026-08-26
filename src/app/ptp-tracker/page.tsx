import React, { Suspense } from 'react';
import AppLayout from '@/components/AppLayout';
import PtpTrackerContent from '../components/PtpTrackerContent';

export default function PtpTrackerPage() {
  return (
    <AppLayout>
      <Suspense fallback={null}>
        <PtpTrackerContent />
      </Suspense>
    </AppLayout>
  );
}
