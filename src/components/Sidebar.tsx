'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import AppLogo from '@/components/ui/AppLogo';
import BrandWordmark from '@/components/ui/BrandWordmark';
import ThemeToggle from '@/components/ui/ThemeToggle';
import { useOnlineStatus, usePendingSyncCount } from '@/lib/use-offline';
import { getNavGroups, displayRole, type CurrentUser, type NavGroup } from '@/lib/nav-groups';
import {
  ChevronLeft,
  ChevronRight,
  Wifi,
  WifiOff,
  LogOut,
  Bell,
} from 'lucide-react';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
  user: CurrentUser | null;
}

export default function Sidebar({ collapsed, onToggleCollapse, mobileOpen, onMobileClose, user }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isOnline = useOnlineStatus();
  const pendingSync = usePendingSyncCount();

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/sign-up-login-screen');
    router.refresh();
  }

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(href + '/');
  };

  const navGroups = user ? getNavGroups(user.role) : [];
  const sidebarWidth = collapsed ? 'w-16' : 'w-60';

  return (
    <>
      {/* Mobile sidebar — a sibling of the desktop aside, not nested inside it.
          The desktop aside below is `hidden` below the lg breakpoint, and a
          `display:none` parent hides all descendants regardless of their own
          classes, so nesting this here meant it could never appear on mobile. */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-60 bg-card border-r border-border
          flex flex-col lg:hidden
          sidebar-transition
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <SidebarContent
          collapsed={false}
          onToggleCollapse={onMobileClose}
          isOnline={isOnline}
          pendingSync={pendingSync}
          isActive={isActive}
          navGroups={navGroups}
          isMobile
          user={user}
          onSignOut={handleSignOut}
        />
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={`
          ${sidebarWidth} sidebar-transition shrink-0
          hidden lg:flex flex-col
          bg-card border-r border-border
          relative z-30
        `}
      >
        <SidebarContent
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          isOnline={isOnline}
          pendingSync={pendingSync}
          isActive={isActive}
          navGroups={navGroups}
          isMobile={false}
          user={user}
          onSignOut={handleSignOut}
        />
      </aside>
    </>
  );
}

interface SidebarContentProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  isOnline: boolean;
  pendingSync: number;
  isActive: (href: string) => boolean;
  navGroups: NavGroup[];
  isMobile: boolean;
  user: CurrentUser | null;
  onSignOut: () => void;
}

function SidebarContent({ collapsed, onToggleCollapse, isOnline, pendingSync, isActive, navGroups, isMobile, user, onSignOut }: SidebarContentProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className={`flex items-center h-14 border-b border-border shrink-0 ${collapsed && !isMobile ? 'justify-center px-0' : 'px-4 gap-2'}`}>
        <AppLogo size={collapsed && !isMobile ? 40 : 72} />
        {(!collapsed || isMobile) && <BrandWordmark size="sm" />}
      </div>

      {/* Sync status */}
      {(!collapsed || isMobile) && (
        <div className={`mx-3 mt-3 px-3 py-2 rounded-md border flex items-center gap-2 text-xs font-medium ${isOnline ? 'sync-online' : 'sync-offline'}`}>
          {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
          <span>
            {isOnline
              ? (pendingSync > 0 ? `Online — syncing ${pendingSync}…` : 'Online — Synced')
              : `Offline${pendingSync > 0 ? ` — ${pendingSync} pending` : ''}`}
          </span>
        </div>
      )}

      {collapsed && !isMobile && (
        <div className="flex justify-center mt-3">
          <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-positive' : 'bg-negative'}`} title={isOnline ? 'Online' : 'Offline'} />
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin py-3 px-2">
        {navGroups.map((group) => (
          <div key={`group-${group.label}`} className="mb-4">
            {(!collapsed || isMobile) && (
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground px-2 mb-1">
                {group.label}
              </p>
            )}
            {group.items.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={`nav-${item.label}`}
                  href={item.href}
                  onClick={() => { if (isMobile) onToggleCollapse(); }}
                  className={`
                    group relative flex items-center gap-3 px-2 py-2 rounded-md mb-0.5
                    transition-all duration-150 text-sm font-medium
                    ${active
                      ? 'bg-primary/10 text-primary' :'text-secondary-foreground hover:bg-secondary hover:text-foreground'
                    }
                    ${collapsed && !isMobile ? 'justify-center' : ''}
                  `}
                  title={collapsed && !isMobile ? item.label : undefined}
                >
                  <item.icon size={18} className="shrink-0" />
                  {(!collapsed || isMobile) && (
                    <span className="flex-1 truncate">{item.label}</span>
                  )}
                  {collapsed && !isMobile && (
                    <span className="absolute left-full ml-2 px-2 py-1 bg-foreground text-primary-foreground text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                      {item.label}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Bottom */}
      <div className="border-t border-border p-2 space-y-1">
        <ThemeToggle collapsed={collapsed && !isMobile} />

        {(!collapsed || isMobile) && (
          <button className="w-full flex items-center gap-3 px-2 py-2 rounded-md text-sm font-medium text-secondary-foreground hover:bg-secondary transition-colors">
            <Bell size={18} />
            <span>Notifications</span>
            <span className="ml-auto bg-negative text-white text-xs font-semibold px-1.5 py-0.5 rounded-full">2</span>
          </button>
        )}

        <div className={`flex items-center gap-2 px-2 py-2 ${collapsed && !isMobile ? 'justify-center flex-col' : ''}`}>
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <span className="text-xs font-semibold text-primary">
              {user ? user.name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() : '—'}
            </span>
          </div>
          {(!collapsed || isMobile) && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground truncate">{user?.name ?? 'Loading…'}</p>
              <p className="text-xs text-muted-foreground truncate">{user ? displayRole(user) : ''}</p>
            </div>
          )}
          {(!collapsed || isMobile) && (
            <button
              onClick={onSignOut}
              className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
              title="Sign out"
            >
              <LogOut size={15} />
            </button>
          )}
        </div>

        {!isMobile && (
          <button
            onClick={onToggleCollapse}
            className="w-full flex items-center justify-center py-1.5 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}