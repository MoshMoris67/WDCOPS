'use client';

import { useEffect, useState } from 'react';
import { CACHE_CHANGED_EVENT, getOfflineReadiness, type OfflineReadiness } from './offline-cache';

const initialState: OfflineReadiness = { ready: false, queueCount: 0, cachedAt: null, missing: [] };

export function useOfflineReadiness(enabled: boolean): OfflineReadiness {
  const [readiness, setReadiness] = useState(initialState);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const refresh = () => getOfflineReadiness().then((next) => { if (!cancelled) setReadiness(next); });
    refresh();
    window.addEventListener(CACHE_CHANGED_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(CACHE_CHANGED_EVENT, refresh);
    };
  }, [enabled]);

  return readiness;
}