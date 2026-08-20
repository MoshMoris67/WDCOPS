'use client';

import React from 'react';
import { LucideIcon } from 'lucide-react';

interface FabProps {
  onClick: () => void;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
}

// Mobile-only — a persistent create action reachable no matter how far the page has
// scrolled, unlike a header button that scrolls out of view. bottom-20 clears the
// bottom tab bar.
export default function Fab({ onClick, label, icon: Icon, disabled }: FabProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="lg:hidden fixed bottom-20 right-4 z-40 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-modal flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50 disabled:active:scale-100"
    >
      <Icon size={22} />
    </button>
  );
}
