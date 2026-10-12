import React from 'react';
import { t } from '@/i18n';

interface BrandWordmarkProps {
  size?: 'sm' | 'md';
}

// Fixed brand colors (white / red / black), independent of the light/dark theme —
// literal values, not the --token system, so this reads identically either way.
// The black comes from the glass container itself; white/red are the two text rows.
export default function BrandWordmark({ size = 'md' }: BrandWordmarkProps) {
  const isSm = size === 'sm';
  const tagline = t('Debt Collectors');
  return (
    <div
      style={{
        background: 'rgba(8,10,16,0.62)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.14)',
        borderRadius: 10,
        padding: isSm ? '4px 10px' : '6px 13px',
        display: 'inline-flex',
        flexDirection: 'column',
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: isSm ? 11 : 13,
          fontWeight: 800,
          color: '#FFFFFF',
          letterSpacing: '0.02em',
          lineHeight: 1.2,
          whiteSpace: 'nowrap',
        }}
      >
        {t('WELLCASH')}
      </span>
      <span
        style={{
          fontSize: isSm ? 8 : 9,
          fontWeight: 700,
          color: '#EF4444',
          letterSpacing: tagline.length > 15 ? '0.03em' : '0.13em', // longer translations need tighter spacing to fit the badge
          textTransform: 'uppercase',
          lineHeight: 1.3,
          whiteSpace: 'nowrap',
        }}
      >
        {tagline}
      </span>
    </div>
  );
}
