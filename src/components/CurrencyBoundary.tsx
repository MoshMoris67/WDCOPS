'use client';

import React from 'react';
import { useCurrencyCode } from '@/lib/currency-store';

// Re-creates everything inside it whenever the demo's display currency changes. The screens
// format amounts by calling plain functions while they render (lib/money.ts), so they need a
// fresh render to pick up a new currency; keying the subtree is the simplest way to give
// every one of them that without touching each screen.
export default function CurrencyBoundary({ children }: { children: React.ReactNode }) {
  const code = useCurrencyCode();
  return <React.Fragment key={code}>{children}</React.Fragment>;
}
