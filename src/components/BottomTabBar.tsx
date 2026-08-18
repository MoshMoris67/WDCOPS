'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Phone, FolderOpen, RefreshCcw, MoreHorizontal } from 'lucide-react';
import type { CurrentUser } from '@/lib/nav-groups';

interface BottomTabBarProps {
  user: CurrentUser;
  onMoreClick: () => void;
}

const ADMIN_TABS = [
  { href: '/team-dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/agent-dashboard', label: 'My Queue', icon: Phone },
  { href: '/file-management-distribution', label: 'Files', icon: FolderOpen },
  { href: '/reconciliation-management', label: 'Recon', icon: RefreshCcw },
];

// Thumb-reachable primary nav for mobile — a bottom bar instead of forcing every nav
// action through the drawer. Admin-only: the agent role has exactly one destination
// today, which the existing hamburger already reaches in one tap. The remaining admin
// items (Reports/Users/Settings) live behind "More", which opens the same drawer the
// hamburger does — nothing is removed, just demoted one tap deeper.
export default function BottomTabBar({ user, onMoreClick }: BottomTabBarProps) {
  if (user.role !== 'admin') return null;

  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-card border-t border-border flex items-stretch h-16">
      {ADMIN_TABS.map((tab) => {
        const active = isActive(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
              active ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            <tab.icon size={19} />
            {tab.label}
          </Link>
        );
      })}
      <button
        onClick={onMoreClick}
        className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground"
      >
        <MoreHorizontal size={19} />
        More
      </button>
    </nav>
  );
}
