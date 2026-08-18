import { db, type PendingCallLog } from './offline-db';

export const QUEUE_CHANGED_EVENT = 'wc:queue-changed';

function notifyQueueChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
}

/** Saves a call log locally when the network is unavailable — mirrors §3.1's offline-first promise. */
export async function queueCallLog(entry: Omit<PendingCallLog, 'localId' | 'queuedAt'>): Promise<void> {
  await db.pendingCallLogs.add({ ...entry, queuedAt: new Date().toISOString() });
  notifyQueueChanged();
}

export async function getPendingCount(): Promise<number> {
  return db.pendingCallLogs.count();
}

export async function getPendingLogs(): Promise<PendingCallLog[]> {
  return db.pendingCallLogs.orderBy('queuedAt').toArray();
}

let flushing = false;

/** Drains the local queue against the real API, oldest first. Stops at the first failure and leaves the rest queued for the next attempt. */
export async function flushQueue(): Promise<{ synced: number }> {
  if (flushing || typeof navigator === 'undefined' || !navigator.onLine) return { synced: 0 };
  flushing = true;
  let synced = 0;
  try {
    const pending = await getPendingLogs();
    for (const entry of pending) {
      try {
        const res = await fetch('/api/call-logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            debtorId: entry.debtorId,
            dispositionCode: entry.dispositionCode,
            note: entry.note,
            promisedAmount: entry.promisedAmount,
            promisedDate: entry.promisedDate,
          }),
        });
        if (!res.ok) break; // validation/auth issue — leave queued rather than silently drop it
        await db.pendingCallLogs.delete(entry.localId!);
        synced++;
      } catch {
        break; // still offline or the request failed to even reach the server
      }
    }
  } finally {
    flushing = false;
    if (synced > 0) notifyQueueChanged();
  }
  return { synced };
}
