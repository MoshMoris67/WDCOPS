'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import BottomTabBar from './BottomTabBar';
import BrandWordmark from '@/components/ui/BrandWordmark';
import { flushQueue } from '@/lib/offline-sync';
import { revalidateEssentials } from '@/lib/offline-cache';
import { useCurrentUser } from '@/lib/use-current-user';

interface AppLayoutProps {
  children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    flushQueue();
    revalidateEssentials();
    // Catches the case navigator.onLine's own 'online' event misses: the browser never
    // reports going offline (e.g. the server is just unreachable, or a request quietly
    // times out) so nothing else re-triggers a retry/refresh. A cheap periodic sweep is a
    // no-op when there's nothing pending or nothing worth refreshing, so this costs
    // nothing on the common path.
    const interval = setInterval(() => {
      flushQueue();
      revalidateEssentials();
    }, 45000);
    return () => clearInterval(interval);
  }, []);

  // Cache-backed: a failed fetch here (offline mid-session) no longer wipes out `user`
  // and drops Sidebar/BottomTabBar into a logged-out-looking state — it just keeps
  // showing whoever was last known to be signed in.
  const { data: userData, refetch: refetchUser } = useCurrentUser();
  const user = userData?.user ?? null;
  useEffect(() => {
    refetchUser();
  }, [pathname, refetchUser]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-foreground/40 z-40 lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
        user={user}
      />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile topbar */}
        <div className="lg:hidden flex items-center gap-3 px-4 h-14 bg-card border-b border-border shrink-0">
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="p-2 rounded-md hover:bg-secondary transition-colors"
            aria-label="Open menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <BrandWordmark size="sm" />
        </div>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto scrollbar-thin pb-16 lg:pb-0">
          {children}
        </main>
      </div>

      {user && <BottomTabBar user={user} onMoreClick={() => setMobileSidebarOpen(true)} />}
    </div>
  );
}