'use client';

import { useEffect } from 'react';
import { useCachedQuery } from './use-cached-query';

export interface ClientOption {
  id: string;
  name: string;
  reconciliationType: string;
  reportingFrequency: string;
}

/**
 * Fetches the client list, keeps it from going stale, and now also survives an offline
 * reload — a plain fetch-on-mount used to leave every filter/select blank the moment the
 * network was down, even though the list had already been fetched once before. Refetching
 * on focus and tab-visibility still covers the "an admin edited it in another tab" case;
 * being cache-backed additionally covers "there's no network at all right now".
 */
export function useClients(): ClientOption[] {
  const { data, refetch } = useCachedQuery<{ clients: ClientOption[] }>('/api/clients');

  useEffect(() => {
    const onFocus = () => refetch();
    const onVisibility = () => { if (document.visibilityState === 'visible') refetch(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refetch]);

  return data?.clients ?? [];
}
