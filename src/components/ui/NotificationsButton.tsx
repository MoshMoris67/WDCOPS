'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, Clock, AlertTriangle, CheckCircle, XCircle, UploadCloud } from 'lucide-react';

interface Notification {
  id: string;
  kind: 'ptp_due' | 'stale' | 'import_done' | 'import_failed' | 'file_uploaded' | 'reconciliation_uploaded';
  message: string;
  href: string;
}

const ICONS: Record<Notification['kind'], typeof Clock> = {
  ptp_due: Clock,
  stale: AlertTriangle,
  import_done: CheckCircle,
  import_failed: XCircle,
  file_uploaded: UploadCloud,
  reconciliation_uploaded: UploadCloud,
};

interface NotificationsButtonProps {
  collapsed?: boolean;
  scope?: 'mine' | 'branch';
}

export default function NotificationsButton({ collapsed, scope = 'branch' }: NotificationsButtonProps) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const qs = scope === 'mine' ? '?scope=mine' : '';
    fetch(`/api/notifications${qs}`)
      .then((r) => r.json())
      .then((d) => setNotifications(d.notifications ?? []))
      .catch(() => setNotifications([]));
  }, [scope]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center gap-3 px-2 py-2 rounded-md text-sm font-medium text-secondary-foreground hover:bg-secondary transition-colors ${collapsed ? 'justify-center' : ''}`}
      >
        <Bell size={18} className="shrink-0" />
        {!collapsed && <span>Notifications</span>}
        {notifications.length > 0 && (
          <span className={`bg-negative text-white text-xs font-semibold px-1.5 py-0.5 rounded-full ${collapsed ? 'absolute -top-1 -right-1' : 'ml-auto'}`}>
            {notifications.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-80 max-w-[90vw] bg-card border border-border rounded-xl shadow-dropdown z-50 fade-in overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-sm font-semibold text-foreground">Notifications</p>
          </div>
          <div className="max-h-80 overflow-y-auto scrollbar-thin divide-y divide-border">
            {notifications.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground text-center">Nothing needs your attention right now.</p>
            ) : (
              notifications.map((n) => {
                const Icon = ICONS[n.kind];
                const tone = n.kind === 'import_failed' ? 'text-negative'
                  : n.kind === 'import_done' ? 'text-positive'
                  : n.kind === 'ptp_due' ? 'text-info'
                  : (n.kind === 'file_uploaded' || n.kind === 'reconciliation_uploaded') ? 'text-info'
                  : 'text-warning';
                return (
                  <Link
                    key={n.id}
                    href={n.href}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-2.5 px-4 py-3 hover:bg-secondary/50 transition-colors"
                  >
                    <Icon size={15} className={`shrink-0 mt-0.5 ${tone}`} />
                    <span className="text-xs text-foreground leading-snug">{n.message}</span>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
