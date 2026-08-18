'use client';

import { useCallback, useEffect, useState } from 'react';

export interface ClientOption {
  id: string;
  name: string;
  reconciliationType: string;
  reportingFrequency: string;
}

/**
 * Fetches the client list and keeps it from going stale. A plain fetch-on-mount
 * looks fine until an admin renames/adds/deletes a client in one tab (or via
 * Settings) while this page was already sitting open in another — the dropdown
 * then silently shows whatever it had at mount time. Refetching on focus and
 * tab-visibility covers that without needing a global store for something this
 * small — every filter/select that lists clients should use this instead of
 * its own inline `fetch('/api/clients')`.
 */
export function useClients(): ClientOption[] {
  const [clients, setClients] = useState<ClientOption[]>([]);

  const load = useCallback(() => {
    fetch('/api/clients').then((r) => r.json()).then((d) => setClients(d.clients ?? []));
  }, []);

  useEffect(() => {
    load();
    const onFocus = () => load();
    const onVisibility = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  return clients;
}
