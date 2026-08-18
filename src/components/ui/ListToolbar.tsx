'use client';

import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';

interface FilterOption {
  value: string;
  label: string;
}

interface ListToolbarFilter {
  key: string;
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  variant?: 'select' | 'chips';
}

interface ListToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filters?: ListToolbarFilter[];
  action?: React.ReactNode;
}

// Consolidates the mixed search-input / dropdown-filter / chip-toggle patterns that used
// to be hand-rolled per screen. Debounces the search box internally (~300ms) so callers
// whose search hits the server (or just re-filters a big in-memory list) don't re-run on
// every keystroke; the input itself stays responsive via local state.
export default function ListToolbar({ search, onSearchChange, searchPlaceholder = 'Search…', filters = [], action }: ListToolbarProps) {
  const [localSearch, setLocalSearch] = useState(search);

  useEffect(() => setLocalSearch(search), [search]);

  useEffect(() => {
    const id = setTimeout(() => {
      if (localSearch !== search) onSearchChange(localSearch);
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSearch]);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder={searchPlaceholder}
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          className="pl-8 pr-3 py-1.5 text-sm bg-input border border-border rounded-lg w-40 focus:outline-none focus:ring-2 focus:ring-ring/50"
        />
      </div>

      {filters.map((f) =>
        (f.variant ?? 'select') === 'select' ? (
          <select
            key={f.key}
            value={f.value}
            onChange={(e) => f.onChange(e.target.value)}
            className="text-sm bg-input border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring/50"
          >
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <div key={f.key} className="flex items-center gap-1 bg-secondary/60 rounded-lg p-0.5">
            {f.options.map((o) => (
              <button
                key={o.value}
                onClick={() => f.onChange(o.value)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  f.value === o.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        )
      )}

      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}
