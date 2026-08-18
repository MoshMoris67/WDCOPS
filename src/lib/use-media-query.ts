'use client';

import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const listener = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', listener);
    return () => mql.removeEventListener('change', listener);
  }, [query]);

  return matches;
}

// Matches this app's Tailwind `xl:` breakpoint — the gate for the agent-queue split panel,
// which needs real desktop width for a queue + detail two-column layout to make sense.
export function useIsWide(): boolean {
  return useMediaQuery('(min-width: 1280px)');
}
