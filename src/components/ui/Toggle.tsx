'use client';

import React from 'react';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

export default function Toggle({ checked, onChange, label, disabled, size = 'md' }: ToggleProps) {
  const trackSize = size === 'sm' ? 'w-8 h-4' : 'w-10 h-5';
  const thumbSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
  const thumbTranslate = size === 'sm' ? (checked ? 'translate-x-4' : 'translate-x-0.5') : (checked ? 'translate-x-5' : 'translate-x-0.5');

  return (
    <label className={`inline-flex items-center gap-2 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
      <div
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        className={`
          relative ${trackSize} rounded-full transition-colors duration-200
          ${checked ? 'bg-primary' : 'bg-muted'}
          ${disabled ? 'pointer-events-none' : ''}
        `}
      >
        <span
          className={`
            absolute top-0.5 ${thumbSize} bg-white rounded-full shadow-sm
            transition-transform duration-200 ${thumbTranslate}
          `}
        />
      </div>
      {label && <span className="text-sm font-medium text-foreground">{label}</span>}
    </label>
  );
}