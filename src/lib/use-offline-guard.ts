'use client';

import { useOnlineStatus } from './use-offline';

/** Gates a mutating action that isn't safe to queue offline (unlike call logging, these
 *  touch shared financial/permissions state — reassigning a debtor, distributing a file,
 *  processing a reconciliation, editing a client/code/user). Queueing those blind risks
 *  real conflicts on sync (two offline reassignments of the same debtor, a reconciliation
 *  re-processing against balances that already moved), so they stay online-only and are
 *  disabled with a clear reason instead. */
export function useOfflineGuard(): { blocked: boolean; reason: string } {
  const isOnline = useOnlineStatus();
  return { blocked: !isOnline, reason: 'Offline — reconnect to make this change' };
}
