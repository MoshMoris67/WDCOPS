import { db, type CachedDebtorRow } from './offline-db';

export const CACHE_CHANGED_EVENT = 'wc:cache-changed';

function notifyCacheChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CACHE_CHANGED_EVENT));
}

// Every helper here degrades to a safe no-op rather than throwing — private browsing,
// storage quota limits, or IndexedDB simply being unavailable must never crash the app;
// it should just behave as if nothing were cached yet, same posture as offline-sync.ts.

export async function getCached<T>(key: string): Promise<T | undefined> {
  try {
    const entry = await db.cache.get(key);
    return entry?.data as T | undefined;
  } catch {
    return undefined;
  }
}

export async function getCachedMeta(key: string): Promise<{ fetchedAt: string } | undefined> {
  try {
    const entry = await db.cache.get(key);
    return entry ? { fetchedAt: entry.fetchedAt } : undefined;
  } catch {
    return undefined;
  }
}

export async function setCached<T>(key: string, data: T): Promise<void> {
  try {
    await db.cache.put({ key, data, fetchedAt: new Date().toISOString() });
    notifyCacheChanged();
  } catch {
    // Nothing to do — the live value the caller already has is still used this render;
    // it just won't be there next time.
  }
}

export async function getCachedDebtors(): Promise<CachedDebtorRow[]> {
  try {
    return await db.debtors.toArray();
  } catch {
    return [];
  }
}

export async function getCachedDebtor(id: string): Promise<CachedDebtorRow | undefined> {
  try {
    return await db.debtors.get(id);
  } catch {
    return undefined;
  }
}

export interface OfflineReadiness {
  ready: boolean;
  queueCount: number;
  cachedAt: string | null;
  missing: string[];
}

/** Reports whether the agent has enough local data to keep working through an outage. */
export async function getOfflineReadiness(): Promise<OfflineReadiness> {
  const [identity, codes, clients, debtors] = await Promise.all([
    getCached<{ user?: unknown }>('/api/auth/me'),
    getCached('/api/disposition-codes'),
    getCached('/api/clients'),
    getCachedDebtors(),
  ]);
  const missing: string[] = [];
  if (!identity?.user) missing.push('identity');
  if (!codes) missing.push('disposition codes');
  if (!clients) missing.push('client list');
  if (debtors.length === 0) missing.push('queue');
  return {
    ready: missing.length === 0,
    queueCount: debtors.length,
    cachedAt: debtors[0]?.cachedAt ?? null,
    missing,
  };
}

/**
 * Reconciles the cached queue with the complete server snapshot. Rows that are unchanged
 * are left in IndexedDB, changed/new rows are upserted, and rows no longer assigned are
 * removed. The complete snapshot still matters: it prevents a shared device or a
 * reassignment from leaving stale debtors in the offline queue.
 */
export async function putCachedDebtors(rows: Omit<CachedDebtorRow, 'cachedAt'>[]): Promise<void> {
  try {
    const cachedAt = new Date().toISOString();
    const incoming = rows.map((row) => ({ ...row, cachedAt }));
    await db.transaction('rw', db.debtors, async () => {
      const existing = await db.debtors.toArray();
      const existingById = new Map(existing.map((row) => [row.id, row]));
      const incomingIds = new Set(incoming.map((row) => row.id));
      const staleIds = existing.filter((row) => !incomingIds.has(row.id)).map((row) => row.id);
      const changed = incoming.filter((row) => {
        const previous = existingById.get(row.id);
        if (!previous) return true;
        return Object.keys(row).some((key) => key !== 'cachedAt' && previous[key as keyof CachedDebtorRow] !== row[key as keyof CachedDebtorRow]);
      });
      if (staleIds.length > 0) await db.debtors.bulkDelete(staleIds);
      if (changed.length > 0) await db.debtors.bulkPut(changed);
    });
    notifyCacheChanged();
  } catch {
    // Same as above — this pass just doesn't get persisted.
  }
}

/** Wipes every locally-cached read (queue, debtor detail, disposition codes, identity,
 *  admin lists, ...) — call this on sign-out so a different account logging in on the
 *  same device never has a stale or briefly-mixed-in trace of the previous one's data
 *  to read before its own first fetch completes. Deliberately leaves pendingCallLogs
 *  alone — those are real unsynced work and must survive a logout to still sync later. */
export async function clearReadCache(): Promise<void> {
  try {
    await Promise.all([db.debtors.clear(), db.cache.clear()]);
    notifyCacheChanged();
  } catch {
    // Nothing to do — worst case stale reads linger until overwritten by a fresh fetch.
  }
}

async function fetchJson<T>(url: string, timeoutMs = 8000): Promise<T> {
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
 * Cheap background refresh, called from AppLayout's existing 45s interval — keeps the
 * essentials warm even when their own screen isn't open, so going offline mid-session
 * still leaves a recent mirror behind. Always refreshes identity; only refreshes the
 * agent-specific queue/reference data when the last-known role is 'agent' (or unknown —
 * i.e. nothing cached yet), so an admin session doesn't eagerly warm data it never uses.
 * Each piece is independent and silently skipped on failure — never throws.
 */
export async function revalidateEssentials(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.onLine) return;

  try {
    const me = await fetchJson<{ user: { role: string } | null }>('/api/auth/me');
    await setCached('/api/auth/me', me);

    const role = me.user?.role;
    if (role && role !== 'agent') return; // admin session — its own pages populate their own cache on mount

    const [queue, codes] = await Promise.all([
      fetchJson<{ debtors: Omit<CachedDebtorRow, 'cachedAt'>[] }>('/api/debtors?scope=mine').catch(() => null),
      fetchJson<unknown>('/api/disposition-codes').catch(() => null),
    ]);
    if (queue) await putCachedDebtors(queue.debtors);
    if (codes) await setCached('/api/disposition-codes', codes);
  } catch {
    // Offline, or the very first request (identity) failed — nothing more to do this pass.
  }
}
