'use client';

import React from 'react';
import { DEPLOYMENT } from '@/config/deployment';
import { IMPORT_CURRENCIES } from '@/config/currencies';
import { t } from '@/i18n';

interface FileCurrencySelectProps {
  value: string;
  onChange: (code: string) => void;
}

/**
 * Demo only: which currency an uploaded file's amounts are in. The importer converts them to
 * USD (the only currency the demo stores) once, at upload, using the indicative rates in
 * config/currencies.ts. Renders nothing on the Uganda system, which has no such choice.
 */
export default function FileCurrencySelect({ value, onChange }: FileCurrencySelectProps) {
  if (!DEPLOYMENT.demo) return null;
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-foreground uppercase tracking-wide">{t('Amounts in this file are in')}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
      >
        {IMPORT_CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>{c.code} — {t(c.name)}</option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">{t('Converted to US dollars when the file is imported, at indicative rates.')}</p>
    </div>
  );
}
