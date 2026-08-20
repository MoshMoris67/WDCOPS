import { db, type PendingCallLog } from './offline-db';

export const QUEUE_CHANGED_EVENT = 'wc:queue-changed';

function notifyQueueChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
}

function newClientId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Saves a call log locally, unconditionally — this never checks connectivity and never
 * awaits the network. Every disposition becomes durable the instant the agent submits it;
 * whether and when it reaches the server is a separate concern handled below. This is what
 * makes the queue safe against `navigator.onLine` being wrong (e.g. "online" but the request
 * still times out) instead of just against the browser being visibly offline.
 */
export async function queueCallLog(
  entry: Omit<PendingCallLog, 'localId' | 'queuedAt' | 'clientId' | 'status' | 'attempts' | 'lastError'>
): Promise<number> {
  const localId = await db.pendingCallLogs.add({
    ...entry,
    clientId: newClientId(),
    queuedAt: new Date().toISOString(),
    status: 'pending',
    attempts: 0,
    lastError: null,
  });
  notifyQueueChanged();
  // Dexie's type only allows `undefined` because the primary key field is declared
  // optional (callers never set it); an autoincrement add() always returns the real id.
  return localId as number;
}

export async function getPendingCount(): Promise<number> {
  return db.pendingCallLogs.where('status').equals('pending').count();
}

export async function getFailedCount(): Promise<number> {
  return db.pendingCallLogs.where('status').equals('failed').count();
}

export async function getPendingLogs(): Promise<PendingCallLog[]> {
  return db.pendingCallLogs.orderBy('queuedAt').toArray();
}

type SyncOutcome = { ok: true } | { ok: false; retryable: boolean; message: string };

/** Pushes one queued entry to the real API. Never throws — every failure mode (network,
 *  timeout, server rejection) comes back as data so the caller can decide what to do. */
async function pushEntry(entry: PendingCallLog): Promise<SyncOutcome> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch('/api/call-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        debtorId: entry.debtorId,
        dispositionCode: entry.dispositionCode,
        note: entry.note,
        promisedAmount: entry.promisedAmount,
        promisedDate: entry.promisedDate,
      }),
    });
    if (res.ok) return { ok: true };
    // A 4xx means the server has judged this exact record invalid (deleted debtor, retired
    // disposition code, etc). Retrying it unchanged will never succeed, so it must not be
    // allowed to sit at the head of the queue blocking every record behind it.
    const retryable = res.status >= 500;
    const payload = await res.json().catch(() => null);
    return { ok: false, retryable, message: payload?.error || `Server rejected the request (${res.status})` };
  } catch (err) {
    // Network error, timeout, or genuinely offline — always retryable, this says nothing
    // about whether the record itself is valid.
    return { ok: false, retryable: true, message: err instanceof Error ? err.message : 'Network error' };
  } finally {
    clearTimeout(timeout);
  }
}

async function markOutcome(entry: PendingCallLog, outcome: SyncOutcome): Promise<void> {
  if (outcome.ok) {
    await db.pendingCallLogs.delete(entry.localId!);
    return;
  }
  await db.pendingCallLogs.update(entry.localId!, {
    attempts: (entry.attempts ?? 0) + 1,
    lastError: outcome.message,
    status: outcome.retryable ? 'pending' : 'failed',
  });
}

/**
 * Attempts one entry right away — called immediately after queueing so an agent who's
 * actually online still sees "synced" instead of always being told "queued". If this
 * doesn't land within the timeout it just leaves the record queued for the background
 * flush to pick up later; nothing is lost either way.
 */
export async function syncOneNow(localId: number): Promise<SyncOutcome> {
  const entry = await db.pendingCallLogs.get(localId);
  if (!entry) return { ok: true }; // already synced and removed
  const outcome = await pushEntry(entry);
  await markOutcome(entry, outcome);
  if (outcome.ok) notifyQueueChanged();
  return outcome;
}

let flushing = false;

/**
 * Drains every 'pending' entry against the real API, oldest first. Each entry is isolated
 * in its own try path: a rejected record is marked 'failed' and skipped rather than
 * aborting the whole run, so one bad record can never strand every record behind it.
 * Stops early only after two consecutive *network-level* failures in the same pass — that
 * pattern means "we're actually offline", not "this record is bad", and there's no point
 * burning a timeout on every remaining item just to confirm that repeatedly.
 */
export async function flushQueue(): Promise<{ synced: number; failed: number }> {
  if (flushing || typeof navigator === 'undefined' || !navigator.onLine) return { synced: 0, failed: 0 };
  flushing = true;
  let synced = 0;
  let failed = 0;
  let consecutiveNetworkFailures = 0;
  try {
    const pending = await db.pendingCallLogs.where('status').equals('pending').sortBy('queuedAt');
    for (const entry of pending) {
      const outcome = await pushEntry(entry);
      await markOutcome(entry, outcome);
      if (outcome.ok) {
        synced++;
        consecutiveNetworkFailures = 0;
      } else if (outcome.retryable) {
        consecutiveNetworkFailures++;
        if (consecutiveNetworkFailures >= 2) break;
      } else {
        failed++;
        consecutiveNetworkFailures = 0;
      }
    }
  } finally {
    flushing = false;
    if (synced > 0 || failed > 0) notifyQueueChanged();
  }
  return { synced, failed };
}

/** Gives every 'failed' entry another chance — e.g. after an admin restores the debtor or
 *  re-adds the disposition code that caused the original rejection. The equivalent of a
 *  manual "force sync": it clears the quarantine and lets flushQueue retry everything. */
export async function retryFailed(): Promise<{ synced: number; failed: number }> {
  await db.pendingCallLogs.where('status').equals('failed').modify({ status: 'pending' });
  notifyQueueChanged();
  return flushQueue();
}
