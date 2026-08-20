'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getCached, getCachedMeta, setCached, CACHE_CHANGED_EVENT } from './offline-cache';

interface UseCachedQueryOptions<T> {
  /** Set to false to skip fetching entirely — e.g. while a required id is still null. */
  enabled?: boolean;
  fetcher?: (url: string) => Promise<T>;
  timeoutMs?: number;
}

export interface CachedQueryResult<T> {
  /** The cached value, then the live value once a fetch resolves — this is never
   *  cleared just because a fetch failed. A failed request only ever adds `error`
   *  alongside whatever was already on screen. */
  data: T | undefined;
  /** True only until the very first read (cache or network, whichever lands) settles. */
  isLoading: boolean;
  /** True while `data` is what was already on disk, not this render's own network response. */
  isFromCache: boolean;
  error: string | null;
  cachedAt: string | null;
  refetch: () => void;
}

async function defaultFetcher<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The read-side counterpart to offline-sync.ts's write queue: read the local cache first
 * (instant, works with zero network), fire a live fetch in parallel to refresh it, and
 * never let a failed or slow request erase what's already rendering. This is what lets a
 * screen open with real data even on a cold, fully offline launch — as long as it's been
 * fetched successfully at least once before on this device.
 */
export function useCachedQuery<T>(url: string | null, options?: UseCachedQueryOptions<T>): CachedQueryResult<T> {
  const { enabled = true, fetcher, timeoutMs = 8000 } = options ?? {};
  const [data, setData] = useState<T | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [isFromCache, setIsFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [refetchTick, setRefetchTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refetch = useCallback(() => setRefetchTick((n) => n + 1), []);

  useEffect(() => {
    if (!url || !enabled) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;

    (async () => {
      const [cached, meta] = await Promise.all([getCached<T>(url), getCachedMeta(url)]);
      if (cancelled) return;
      if (cached !== undefined) {
        setData(cached);
        setIsFromCache(true);
        setCachedAt(meta?.fetchedAt ?? null);
        setIsLoading(false);
      }

      try {
        const fresh = fetcherRef.current ? await fetcherRef.current(url) : await defaultFetcher<T>(url, timeoutMs);
        if (cancelled) return;
        setData(fresh);
        setIsFromCache(false);
        setError(null);
        setCachedAt(new Date().toISOString());
        setIsLoading(false);
        await setCached(url, fresh);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Request failed');
        setIsLoading(false); // cached data (if any) is already showing — this is informational only
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, enabled, timeoutMs, refetchTick]);

  // A background revalidateEssentials() pass (or another hook instance) may have updated
  // this exact key — pick it up without needing this component to also be the one fetching.
  useEffect(() => {
    if (!url) return;
    const onChanged = () => {
      getCached<T>(url).then((cached) => {
        if (cached !== undefined) setData(cached);
      });
    };
    window.addEventListener(CACHE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CACHE_CHANGED_EVENT, onChanged);
  }, [url]);

  return { data, isLoading, isFromCache, error, cachedAt, refetch };
}
