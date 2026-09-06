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

/**
 * Replaces the ENTIRE cached queue with exactly this snapshot — not an upsert. The
 * `/api/debtors?scope=mine` response is always the caller's complete current queue, so
 * anything not in it must be gone from the cache too (reassigned away, or — on a shared
 * device — simply a different agent's debtors from a previous login). A plain bulkPut
 * only ever adds/overwrites by id and never removes, which is exactly what let one
 * agent's queue silently accumulate on top of another's every time someone new signed
 * in on the same browser: 682 debtors, then 682+686, then +684, approaching the whole
 * table. Clear-then-insert in one transaction closes that gap without a window where
 * the table sits empty mid-write.
 */
export async function putCachedDebtors(rows: Omit<CachedDebtorRow, 'cachedAt'>[]): Promise<void> {
  try {
    const cachedAt = new Date().toISOString();
    await db.transaction('rw', db.debtors, async () => {
      await db.debtors.clear();
      await db.debtors.bulkPut(rows.map((row) => ({ ...row, cachedAt })));
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
