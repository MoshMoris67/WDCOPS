'use client';

import { useEffect, useState } from 'react';

// The <head> script in layout.tsx already applies the saved class before paint —
// this hook just keeps React state in sync with it and handles toggling.
export function useTheme(): ['light' | 'dark', () => void] {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem('theme', next);
    } catch {
      // ignore — the toggle still works for the current page view
    }
  }

  return [theme, toggle];
}
