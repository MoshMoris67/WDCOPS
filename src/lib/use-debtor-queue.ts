'use client';

import { useEffect, useState } from 'react';
import { CACHE_CHANGED_EVENT, getCached, getCachedDebtor, getCachedDebtors, putCachedDebtors, setCached } from './offline-cache';
import { type CachedDebtorRow } from './offline-db';

interface UseDebtorQueueResult {
  debtors: CachedDebtorRow[];
  isLoading: boolean;
  isFromCache: boolean;
  cachedAt: string | null;
  error: string | null;
  refetch: () => void;
  total: number;
  pageSize: number;
}

interface QueueOptions {
  search?: string;
  clientId?: string | null;
  sortField?: string | null;
  sortDir?: 'asc' | 'desc';
  page?: number;
}

/** The agent's full assigned queue — same data `/api/debtors?scope=mine` returns, mirrored
 *  in Dexie's `debtors` table so the queue list and dashboard KPIs render instantly even on
 *  a cold, offline launch, as long as this device has fetched it at least once before. */
export function useDebtorQueue(options?: QueueOptions): UseDebtorQueueResult {
  const search = options?.search?.trim() ?? '';
  const clientId = options?.clientId ?? null;
  const sortField = options?.sortField ?? null;
  const sortDir = options?.sortDir ?? 'asc';
  const page = options?.page ?? 1;
  const isPaged = options !== undefined;
  const queryKey = isPaged
    ? `/api/debtors?scope=mine&page=${page}&pageSize=50${search ? `&search=${encodeURIComponent(search)}` : ''}${clientId ? `&clientId=${encodeURIComponent(clientId)}` : ''}${sortField ? `&sort=${encodeURIComponent(sortField)}&dir=${sortDir}` : ''}`
    : '/api/debtors?scope=mine';
  const [debtors, setDebtors] = useState<CachedDebtorRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFromCache, setIsFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refetchTick, setRefetchTick] = useState(0);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(0);
  const refetch = () => setRefetchTick((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    (async () => {
      const cachedPage = isPaged
        ? await getCached<{ debtors: CachedDebtorRow[]; total: number; pageSize: number }>(queryKey)
        : undefined;
      const cachedFull = await getCachedDebtors();
      if (cancelled) return;
      const cachedRows = cachedPage?.debtors ?? (isPaged ? cachedFull.slice((page - 1) * 50, page * 50) : cachedFull);
      if (cachedRows.length > 0) {
        setDebtors(cachedRows);
        setIsFromCache(true);
        setCachedAt(cachedRows[0]?.cachedAt ?? null);
        if (cachedPage) {
          setTotal(cachedPage.total);
          setPageSize(cachedPage.pageSize);
        } else if (isPaged) {
          setTotal(cachedFull.length);
          setPageSize(50);
        }
        setIsLoading(false);
      }

      const controller = new AbortController();
      // A normal queue answers in well under a second, but this endpoint is
      // deliberately unpaginated (see api/debtors/route.ts) — an outlier-large queue
      // (thousands of debtors) is a legitimately bigger payload to transfer, especially
      // over a slow mobile connection, not a hung request. 8s was tuned for a normal
      // queue and was aborting real, still-in-flight responses for a real 10,000+-debtor
      // agent even after the query itself got fast — this is headroom, not a mask.
      const timeout = setTimeout(() => controller.abort(), 25000);
      try {
        const res = await fetch(queryKey, { signal: controller.signal });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const payload: { debtors: Omit<CachedDebtorRow, 'cachedAt'>[]; total: number; pageSize: number } = await res.json();
        if (cancelled) return;
        const refreshed = payload.debtors.map((row) => ({ ...row, cachedAt: new Date().toISOString() }));
        if (isPaged) await setCached(queryKey, { debtors: refreshed, total: payload.total, pageSize: payload.pageSize });
        else await putCachedDebtors(payload.debtors);
        if (cancelled) return;
        setDebtors(refreshed);
        setIsFromCache(false);
        setError(null);
        setCachedAt(refreshed[0]?.cachedAt ?? null);
        setTotal(payload.total);
        setPageSize(payload.pageSize);
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
  }, [queryKey, isPaged, refetchTick]);

  useEffect(() => {
    const onChanged = () => {
      if (isPaged) {
        getCached<{ debtors: CachedDebtorRow[]; total: number; pageSize: number }>(queryKey).then((cached) => {
          if (cached?.debtors.length) {
            setDebtors(cached.debtors);
            setTotal(cached.total);
            setPageSize(cached.pageSize);
          }
        });
      } else {
        getCachedDebtors().then((rows) => {
          if (rows.length > 0) setDebtors(rows);
        });
      }
    };
    window.addEventListener(CACHE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CACHE_CHANGED_EVENT, onChanged);
  }, [isPaged, queryKey]);

  return { debtors, isLoading, isFromCache, cachedAt, error, refetch, total, pageSize };
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
