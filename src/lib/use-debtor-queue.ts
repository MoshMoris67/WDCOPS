'use client';

import { useEffect, useState } from 'react';
import { CACHE_CHANGED_EVENT, getCachedDebtor, getCachedDebtors, getCachedQueueOrder, putCachedDebtors } from './offline-cache';
import { type CachedDebtorRow } from './offline-db';

interface UseDebtorQueueResult {
  debtors: CachedDebtorRow[];
  isLoading: boolean;
  isFromCache: boolean;
  cachedAt: string | null;
  error: string | null;
  refetch: () => void;
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
  const [refetchTick, setRefetchTick] = useState(0);
  const refetch = () => setRefetchTick((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    setError(null);

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
      // A normal queue answers in well under a second, but this endpoint is
      // deliberately unpaginated (see api/debtors/route.ts) — an outlier-large queue
      // (thousands of debtors) is a legitimately bigger payload to transfer, especially
      // over a slow mobile connection, not a hung request. 8s was tuned for a normal
      // queue and was aborting real, still-in-flight responses for a real 10,000+-debtor
      // agent even after the query itself got fast — this is headroom, not a mask.
      const timeout = setTimeout(() => controller.abort(), 25000);
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
  }, [refetchTick]);

  useEffect(() => {
    const onChanged = () => {
      getCachedDebtors().then((rows) => {
        if (rows.length > 0) setDebtors(rows);
      });
    };
    window.addEventListener(CACHE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CACHE_CHANGED_EVENT, onChanged);
  }, []);

  return { debtors, isLoading, isFromCache, cachedAt, error, refetch };
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

/** localStorage key for the ordered id list AgentQueueContent stashes right before
 *  navigating to the standalone detail page — see useStandaloneQueueNav below. Exported
 *  so both sides of the handoff use the exact same key. Deliberately localStorage, not
 *  sessionStorage: this has to survive the browser/app process dying (killed in the
 *  background, or the device itself losing power) and being reopened later, not just a
 *  same-tab navigation. */
export const STANDALONE_QUEUE_KEY = 'queue:my-queue';

/**
 * Prev/Next id lookup for the standalone debtor-detail page (no live queue in memory —
 * it's a fresh navigation, possibly after the app was closed and reopened). Falls through
 * three tiers, most specific first:
 *   1. This device's last-viewed queue order (localStorage) — respects whatever
 *      search/client filter/sort was active when the agent opened this debtor.
 *   2. The server's own last-synced order for the full queue (IndexedDB) — covers a
 *      debtor reached without ever visiting /my-queue on this device (a deep link, or a
 *      reload landing straight back on a detail URL after the browser/device restarted).
 *   3. Whatever's in the cached queue at all, in whatever order IndexedDB happens to
 *      return it — not necessarily meaningful order, but Prev/Next having *some*
 *      sequence beats disappearing entirely.
 * Returns nulls (no controls shown) only when none of the three has anything.
 */
export function useStandaloneQueueNav(debtorId: string | null): { prevId: string | null; nextId: string | null } {
  const [ids, setIds] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let list: string[] | null = null;
      try {
        const raw = localStorage.getItem(STANDALONE_QUEUE_KEY);
        list = raw ? JSON.parse(raw) : null;
      } catch {
        list = null;
      }
      if (!list || list.length === 0) {
        list = (await getCachedQueueOrder()) ?? null;
      }
      if (!list || list.length === 0) {
        const rows = await getCachedDebtors();
        list = rows.map((row) => row.id);
      }
      if (!cancelled) setIds(list.length > 0 ? list : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [debtorId]);

  if (!ids || !debtorId) return { prevId: null, nextId: null };
  const idx = ids.indexOf(debtorId);
  return {
    prevId: idx > 0 ? ids[idx - 1] : null,
    nextId: idx >= 0 && idx < ids.length - 1 ? ids[idx + 1] : null,
  };
}
