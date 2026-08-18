'use client';

import { useEffect, useState } from 'react';

// Persists a table/deck view preference per screen (key), e.g. 'viewMode:files' —
// defaults to 'table' on first visit or when localStorage is unavailable.
export function useViewMode(key: string): ['table' | 'deck', (v: 'table' | 'deck') => void] {
  const [mode, setMode] = useState<'table' | 'deck'>('table');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored === 'table' || stored === 'deck') setMode(stored);
    } catch {
      // localStorage unavailable — stays on the 'table' default
    }
  }, [key]);

  function update(v: 'table' | 'deck') {
    setMode(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      // ignore — the toggle still works for the current page view
    }
  }

  return [mode, update];
}
