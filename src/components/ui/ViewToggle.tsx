'use client';

import React from 'react';
import { List, LayoutGrid } from 'lucide-react';

interface ViewToggleProps {
  value: 'table' | 'deck';
  onChange: (value: 'table' | 'deck') => void;
}

// Manual view-mode switch on top of ResponsiveList's 'table'/'deck' modes — the deck card
// is the same one already used for the automatic mobile reflow, just offered at any width.
export default function ViewToggle({ value, onChange }: ViewToggleProps) {
  return (
    <div className="flex items-center gap-0.5 bg-secondary/60 rounded-lg p-0.5">
      <button
        onClick={() => onChange('table')}
        title="Table view"
        className={`p-1.5 rounded-md transition-colors ${value === 'table' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
      >
        <List size={14} />
      </button>
      <button
        onClick={() => onChange('deck')}
        title="Card view"
        className={`p-1.5 rounded-md transition-colors ${value === 'deck' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
      >
        <LayoutGrid size={14} />
      </button>
    </div>
  );
}
