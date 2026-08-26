import {
  LayoutDashboard,
  FolderOpen,
  RefreshCcw,
  BarChart2,
  Users,
  Settings,
  Phone,
  CalendarClock,
} from 'lucide-react';

export interface CurrentUser {
  name: string;
  role: 'admin' | 'agent';
}

export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export function getNavGroups(role: CurrentUser['role']): NavGroup[] {
  if (role === 'agent') {
    return [
      { label: 'Operations', items: [
        { href: '/agent-dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { href: '/my-queue', label: 'My Queue', icon: Phone },
        { href: '/ptp-tracker', label: 'Promises', icon: CalendarClock },
      ] },
    ];
  }

  // Admin covers everything — team oversight and IT administration are one
  // role now, so it's one nav group rather than split across several.
  return [
    { label: 'Admin', items: [
      { href: '/team-dashboard', label: 'Team Overview', icon: LayoutDashboard },
      { href: '/my-queue', label: 'My Queue', icon: Phone },
      { href: '/ptp-tracker', label: 'Promises', icon: CalendarClock },
      { href: '/file-management-distribution', label: 'Files', icon: FolderOpen },
      { href: '/reconciliation-management', label: 'Reconciliations', icon: RefreshCcw },
      { href: '/reports-client-export', label: 'Reports', icon: BarChart2 },
      { href: '/admin-users', label: 'Users', icon: Users },
      { href: '/admin-settings', label: 'Settings', icon: Settings },
    ] },
  ];
}

export const roleLabel: Record<string, string> = {
  admin: 'Admin',
  agent: 'Agent',
};

export function displayRole(user: CurrentUser) {
  return roleLabel[user.role] ?? user.role;
}
