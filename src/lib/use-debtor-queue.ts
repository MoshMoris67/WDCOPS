'use client';

import { useEffect, useState } from 'react';
import { CACHE_CHANGED_EVENT, getCachedDebtor, getCachedDebtors, putCachedDebtors } from './offline-cache';
import { type CachedDebtorRow } from './offline-db';

interface UseDebtorQueueResult {
  debtors: CachedDebtorRow[];
  isLoading: boolean;
  isFromCache: boolean;
  cachedAt: string | null;
  error: string | null;
}

/** The agent's full assigned queue — same data `/api/debtors?scope=mine` returns, mirrored
 *  in Dexie's `debtors` table so the queue list and dashboard KPIs render instantly even on
 *  a cold, offline launch, as long as this device has fetched it at least once before. */
export function useDebtorQueue(): UseDebtorQueueResult {
  const [debtors, setDebtors] = useState<CachedDebtorRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFromCache, setIsFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cached = await getCachedDebtors();
      if (cancelled) return;
      if (cached.length > 0) {
        setDebtors(cached);
        setIsFromCache(true);
        setCachedAt(cached[0]?.cachedAt ?? null);
        setIsLoading(false);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch('/api/debtors?scope=mine', { signal: controller.signal });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const payload: { debtors: Omit<CachedDebtorRow, 'cachedAt'>[] } = await res.json();
        if (cancelled) return;
        await putCachedDebtors(payload.debtors);
        const refreshed = await getCachedDebtors();
        if (cancelled) return;
        setDebtors(refreshed);
        setIsFromCache(false);
        setError(null);
        setCachedAt(refreshed[0]?.cachedAt ?? null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Request failed');
      } finally {
        clearTimeout(timeout);
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onChanged = () => {
      getCachedDebtors().then((rows) => {
        if (rows.length > 0) setDebtors(rows);
      });
    };
    window.addEventListener(CACHE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CACHE_CHANGED_EVENT, onChanged);
  }, []);

  return { debtors, isLoading, isFromCache, cachedAt, error };
}

/** A single queue row, for the debtor-detail page to fall back to when the full detail
 *  response was never individually fetched on this device but the debtor is (or recently
 *  was) in the agent's queue. Deliberately a much smaller shape than full debtor detail —
 *  callers must treat this as a "lite" view, not a substitute for the real thing. */
export function useCachedDebtorLite(id: string | null): CachedDebtorRow | undefined {
  const [row, setRow] = useState<CachedDebtorRow | undefined>(undefined);

  useEffect(() => {
    if (!id) {
      setRow(undefined);
      return;
    }
    let cancelled = false;
    getCachedDebtor(id).then((found) => {
      if (!cancelled) setRow(found);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return row;
}
