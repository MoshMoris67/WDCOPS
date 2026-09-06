import Dexie, { type EntityTable } from 'dexie';

/** One row of an agent's assigned queue, exactly as `/api/debtors?scope=mine` returns it.
 *  Deliberately NOT merged with the debtor-detail shape (see CacheEntry) — the two API
 *  routes return genuinely different fields (`phone` vs `phone1`/`phone2`, etc). */
export interface CachedDebtorRow {
  id: string;
  name: string;
  phone: string;
  loanRef: string;
  amountOwed: number;
  balance: number;
  client: string;
  recentlyPaid?: boolean;
  lastDisposition: string | null;
  lastCallDate: string | null;
  isPTP: boolean;
  activePTP: { amount: number; date: string } | null;
  cachedAt: string;
}

/** Generic read cache for everything else that's just "fetch a URL, get a JSON blob,
 *  render it" — disposition codes, clients, current-user identity, dashboard summary,
 *  debtor detail + call history, admin lists. Keyed by request identity (pathname +
 *  normalized querystring) so distinct queries (e.g. different search filters) get
 *  independent entries.
 *
 *  Hard rule: only ever holds values that already passed through a route's existing
 *  field selection — never a raw/bulk endpoint. Every current route already excludes
 *  sensitive/unbounded fields (Reconciliation.rawRows, User.passwordHash), so this
 *  cache can't leak them as long as it stays fed exclusively by existing fetch responses. */
export interface CacheEntry<T = unknown> {
  key: string;
  data: T;
  fetchedAt: string;
}

export interface PendingCallLog {
  localId?: number;
  clientId: string;
  debtorId: string;
  debtorName: string;
  dispositionCode: string;
  note: string | null;
  promisedAmount: number | null;
  promisedDate: string | null;
  queuedAt: string;
  /** 'pending' retries automatically; 'failed' means the server rejected it outright
   *  (bad data, not a network blip) and it waits for an explicit retry instead of being
   *  retried forever or silently blocking every record queued behind it. */
  status: 'pending' | 'failed';
  attempts: number;
  lastError: string | null;
}

const db = new Dexie('wellcashops-offline') as Dexie & {
  pendingCallLogs: EntityTable<PendingCallLog, 'localId'>;
  debtors: EntityTable<CachedDebtorRow, 'id'>;
  cache: EntityTable<CacheEntry, 'key'>;
};

db.version(1).stores({
  pendingCallLogs: '++localId, debtorId, queuedAt',
});

// Adds per-item retry state so a stuck record can be isolated instead of blocking the
// whole queue. Existing queued rows from before this version predate those fields.
db.version(2)
  .stores({
    pendingCallLogs: '++localId, debtorId, queuedAt, status',
  })
  .upgrade(async (tx) => {
    await tx
      .table('pendingCallLogs')
      .toCollection()
      .modify((log) => {
        if (log.status === undefined) log.status = 'pending';
        if (log.attempts === undefined) log.attempts = 0;
        if (log.lastError === undefined) log.lastError = null;
        if (log.clientId === undefined) log.clientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      });
  });

// Adds the local-first read cache: `debtors` mirrors the agent's queue (id-indexed, since
// the debtor-detail page falls back to a queue row when full detail was never fetched),
// `cache` is a generic key/value store for everything else. Both start empty — nothing
// about the existing tables changes, so no upgrade() is needed.
db.version(3).stores({
  pendingCallLogs: '++localId, debtorId, queuedAt, status',
  debtors: 'id, cachedAt',
  cache: 'key, fetchedAt',
});

export { db };
