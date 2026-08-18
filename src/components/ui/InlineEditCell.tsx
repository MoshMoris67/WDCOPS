'use client';

import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';

interface InlineEditOption {
  value: string;
  label: string;
}

interface InlineEditCellProps {
  value: string;
  displayValue?: string;
  options?: InlineEditOption[];
  onSave: (next: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
}

// One implementation for "click a value, edit it in place, no modal" — a <select> when
// options are given (commits immediately on change, an unambiguous intent signal), else a
// text <input> (commits on blur/Enter, Escape reverts without saving).
export default function InlineEditCell({ value, displayValue, options, onSave, disabled, placeholder }: InlineEditCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  async function commit(next: string) {
    if (next === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  if (saving) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Loader2 size={13} className="animate-spin" /> Saving…
      </span>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setDraft(value); setEditing(true); }}
        className="text-left text-sm text-foreground hover:bg-secondary rounded px-1.5 py-0.5 -mx-1.5 transition-colors disabled:hover:bg-transparent disabled:cursor-default"
      >
        {displayValue ?? value ?? placeholder}
      </button>
    );
  }

  if (options) {
    return (
      <select
        autoFocus
        value={draft}
        onChange={(e) => commit(e.target.value)}
        onBlur={() => setEditing(false)}
        className="text-sm bg-input border border-border rounded-md px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-ring/50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }

  return (
    <input
      autoFocus
      type="text"
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(draft);
        if (e.key === 'Escape') { setDraft(value); setEditing(false); }
      }}
      className="text-sm bg-input border border-border rounded-md px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-ring/50"
    />
  );
}
