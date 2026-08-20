'use client';

import React, { useEffect, useState } from 'react';
import { RefreshCcw, Trash2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { QUEUE_CHANGED_EVENT, discardFailedLog, getFailedLogs, retryFailed, syncOneNow } from '@/lib/offline-sync';
import type { PendingCallLog } from '@/lib/offline-db';

function formatQueuedAt(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface FailedSyncModalProps {
  open: boolean;
  onClose: () => void;
}

/** Retry alone gives no way to see *why* a call log keeps failing to sync — which reads
 *  as broken even when it's working exactly as designed (a record the server has a real,
 *  substantive reason to reject will just fail the same way every time it's retried).
 *  This surfaces that reason per entry and, since retrying can never fix a data problem,
 *  a way to give up on one entry individually instead of it sitting there forever. */
export default function FailedSyncModal({ open, onClose }: FailedSyncModalProps) {
  const [entries, setEntries] = useState<PendingCallLog[]>([]);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [isRetryingAll, setIsRetryingAll] = useState(false);

  useEffect(() => {
    if (!open) return;
    const refresh = () => getFailedLogs().then(setEntries);
    refresh();
    window.addEventListener(QUEUE_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(QUEUE_CHANGED_EVENT, refresh);
  }, [open]);

  async function retryOne(entry: PendingCallLog) {
    setRetryingId(entry.localId!);
    try {
      // Force it back through pushEntry rather than trusting whatever status it's still
      // in — a single-entry equivalent of retryFailed's "reset then flush".
      await syncOneNow(entry.localId!);
    } finally {
      setRetryingId(null);
    }
  }

  async function retryAll() {
    setIsRetryingAll(true);
    try {
      await retryFailed();
    } finally {
      setIsRetryingAll(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Failed to sync"
      subtitle="These logged calls are safe on this device, but the server rejected them — retrying resends the exact same request, so it will only help if the underlying issue (e.g. a reassigned debtor) has since been fixed."
      size="md"
      footer={
        <>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
          >
            Close
          </button>
          <button
            onClick={retryAll}
            disabled={isRetryingAll || entries.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition-all disabled:opacity-60"
          >
            <RefreshCcw size={15} className={isRetryingAll ? 'animate-spin' : ''} />
            Retry All
          </button>
        </>
      }
    >
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">Nothing failed right now.</p>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <div key={entry.localId} className="rounded-lg border border-border p-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{entry.debtorName || entry.debtorId}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.dispositionCode} · queued {formatQueuedAt(entry.queuedAt)} · {entry.attempts} attempt{entry.attempts === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => retryOne(entry)}
                    disabled={retryingId === entry.localId}
                    className="p-1.5 rounded-md hover:bg-primary/10 hover:text-primary transition-colors text-muted-foreground disabled:opacity-50"
                    title="Retry this one"
                  >
                    <RefreshCcw size={14} className={retryingId === entry.localId ? 'animate-spin' : ''} />
                  </button>
                  <button
                    onClick={() => discardFailedLog(entry.localId!)}
                    className="p-1.5 rounded-md hover:bg-[var(--negative-bg)] hover:text-negative transition-colors text-muted-foreground"
                    title="Give up on this one — it will not be synced"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {entry.lastError && (
                <p className="text-xs text-negative bg-[var(--negative-bg)] rounded px-2 py-1">{entry.lastError}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
