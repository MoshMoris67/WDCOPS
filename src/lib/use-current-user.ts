'use client';

import { useCachedQuery, type CachedQueryResult } from './use-cached-query';

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'agent';
}

/** Identity, cache-backed so it survives offline navigation. Session role/name drive
 *  Sidebar's nav and BottomTabBar's visibility — losing them on every offline route
 *  change (the old `fetch('/api/auth/me').catch(() => setUser(null))` behavior) made
 *  the whole app chrome look logged-out the moment the network blipped mid-session. */
export function useCurrentUser(): CachedQueryResult<{ user: CurrentUser | null }> {
  return useCachedQuery<{ user: CurrentUser | null }>('/api/auth/me');
}
