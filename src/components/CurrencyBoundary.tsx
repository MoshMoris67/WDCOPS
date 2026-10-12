'use client';

import React from 'react';
import { useCurrencyCode } from '@/lib/currency-store';
import { useLanguage } from '@/i18n';

// Re-creates everything inside it whenever the demo's display language or currency changes.
// The screens translate text and format amounts by calling plain functions while they render
// (t() in i18n, formatMoney in lib/money.ts), so they need a fresh render to pick up a new
// choice; keying the subtree is the simplest way to give every one of them that without
// touching each screen.
export default function CurrencyBoundary({ children }: { children: React.ReactNode }) {
  const currency = useCurrencyCode();
  const language = useLanguage();
  return <React.Fragment key={`${language}|${currency}`}>{children}</React.Fragment>;
}
