'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Phone, AlertTriangle, WifiOff, ChevronRight, ChevronLeft, Search, ArrowUpDown, Wifi, Maximize2, Minimize2, GripVertical } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import DispositionBadge from '@/components/ui/DispositionBadge';
import { TableRowSkeleton } from '@/components/ui/LoadingSkeleton';
import { useOnlineStatus, usePendingSyncCount } from '@/lib/use-offline';
import { clientBadgeVariant } from '@/lib/client-badge';
import { useClients } from '@/lib/use-clients';
import { toDialFormat } from '@/lib/phone';
import { useDebtorQueue } from '@/lib/use-debtor-queue';
import { useCachedQuery } from '@/lib/use-cached-query';
import { useIsWide } from '@/lib/use-media-query';
import DebtorDetailContent from '@/app/debtor-detail-call-logging/components/DebtorDetailContent';

interface DispositionCodeOption {
  code: string;
  label: string;
  color: string;
}

function formatUGX(amount: number) {
  return 'UGX ' + amount.toLocaleString('en-UG');
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB');
}

const PAGE_SIZE = 50;

export default function AgentQueueContent() {
  const clients = useClients();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('selected');
  const isWide = useIsWide();
  const { debtors: debtorQueue, isLoading, error: queueError, refetch: refetchQueue } = useDebtorQueue();
  const [search, setSearch] = useState('');
  const [filterClient, setFilterClient] = useState('All');
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const { data: codesData } = useCachedQuery<{ codes: DispositionCodeOption[] }>('/api/disposition-codes');
  const dispositionCodes = codesData?.codes ?? [];
  const isOnline = useOnlineStatus();
  const pendingSync = usePendingSyncCount();

  // Desktop split-panel resizing — the detail panel used to be a fixed 50/50 split with
  // the queue table, which left the disposition grid and call-notes box cramped on real
  // laptop-width screens even though there was room to spare. Dragged width is in px;
  // maximized overrides it with a much wider fixed size. Not persisted across reloads —
  // this is a per-session convenience, not a saved preference.
  const DEFAULT_PANEL_WIDTH = 640;
  const MIN_PANEL_WIDTH = 420;
  const MAX_PANEL_WIDTH = 1100;
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [isMaximized, setIsMaximized] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragRef.current) return;
      // Handle sits on the panel's left edge — dragging left (negative delta) widens it.
      const delta = dragRef.current.startX - e.clientX;
      setPanelWidth(Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, dragRef.current.startWidth + delta)));
    }
    function onUp() {
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  function startResize(e: React.MouseEvent) {
    if (isMaximized) return;
    dragRef.current = { startX: e.clientX, startWidth: panelWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  const dispositionColor = (code: string) => dispositionCodes.find((d) => d.code === code)?.color ?? '#64748B';

  const filtered = debtorQueue.filter((d) => {
    // Phone-only, by prefix (not "contains anywhere") — e.g. typing "077" is meant to
    // isolate debtors on that carrier's number block (for dialing through the matching
    // SIM), not pull in unrelated name/loan-ref substring matches. Normalized through the
    // same toDialFormat() used for the Call buttons so a prefix search matches correctly
    // regardless of which raw format ("077...", "77...", "25677...") the number was
    // originally imported in.
    const trimmedSearch = search.trim();
    const matchSearch = !trimmedSearch || toDialFormat(d.phone).startsWith(trimmedSearch);
    const matchClient = filterClient === 'All' || d.client === filterClient;
    return matchSearch && matchClient;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (!sortField) return 0;
    const av = (a as unknown as Record<string, unknown>)[sortField];
    const bv = (b as unknown as Record<string, unknown>)[sortField];
    if (typeof av === 'number' && typeof bv === 'number') {
      return sortDir === 'asc' ? av - bv : bv - av;
    }
    return sortDir === 'asc'
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av));
  });

  // Reset to page 1 whenever the visible set changes shape, so a filter/search never
  // leaves the view stuck on a now-nonexistent page.
  useEffect(() => {
    setPage(1);
  }, [search, filterClient, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageStart = (page - 1) * PAGE_SIZE;
  const paged = sorted.slice(pageStart, pageStart + PAGE_SIZE);

  function toggleSort(field: string) {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  const selectedIndex = selectedId ? sorted.findIndex((d) => d.id === selectedId) : -1;
  const prevId = selectedIndex > 0 ? sorted[selectedIndex - 1].id : null;
  const nextId = selectedIndex >= 0 && selectedIndex < sorted.length - 1 ? sorted[selectedIndex + 1].id : null;

  // At desktop width, opening a debtor selects it into the split panel on this same page
  // instead of navigating away — the queue never leaves the screen. Below that width there's
  // no room for a side-by-side panel, so it falls back to the standalone detail page; the
  // ordered id list is stashed in sessionStorage first so that page's Prev/Next controls
  // still work even though it's a fresh navigation with no live queue in memory.
  function openDebtor(id: string) {
    if (isWide) {
      router.push(`/my-queue?selected=${id}`, { scroll: false });
    } else {
      try {
        sessionStorage.setItem('queue:my-queue', JSON.stringify(sorted.map((d) => d.id)));
      } catch {
        // sessionStorage unavailable (private mode, etc.) — Prev/Next just won't show up
      }
      router.push(`/debtor-detail-call-logging?id=${id}`);
    }
  }

  return (
    <div className="p-6 xl:p-8 2xl:p-10 max-w-screen-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-page-title text-foreground">My Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">{debtorQueue.length} debtors assigned — sorted by priority</p>
        </div>
        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium ${isOnline ? 'sync-online' : 'sync-offline'}`}>
          {isOnline ? <Wifi size={13} /> : <WifiOff size={13} />}
          <span>{isOnline ? 'Synced' : `Offline${pendingSync > 0 ? ` — ${pendingSync} pending` : ''}`}</span>
        </div>
      </div>

      {!isOnline && (
        <div className="flex items-center gap-3 bg-[var(--warning-bg)] border border-[#FDE68A] rounded-lg px-4 py-3">
          <WifiOff size={16} className="text-warning shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-warning">
              Working offline{pendingSync > 0 ? ` — ${pendingSync} call log${pendingSync === 1 ? '' : 's'} pending sync` : ''}
            </p>
            <p className="text-xs text-warning/80">Your logs are saved locally. They will sync automatically when you reconnect.</p>
          </div>
        </div>
      )}

      {/* A failed fetch used to look identical to "no debtors assigned" — same empty
          table, no indication anything went wrong. This makes that failure visible
          instead of silently showing 0. */}
      {queueError && (
        <div className="flex items-center gap-3 bg-[var(--warning-bg)] border border-[#FDE68A] rounded-lg px-4 py-3">
          <AlertTriangle size={16} className="text-warning shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-warning">Could not load your queue — showing what&apos;s saved on this device.</p>
            <p className="text-xs text-warning/80">{queueError}. Your actual assigned list may be different from what&apos;s shown below.</p>
          </div>
          <button
            onClick={refetchQueue}
            className="text-xs font-semibold text-warning hover:underline shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      <div className={`flex flex-col gap-6 ${isWide && selectedId ? 'xl:flex-row xl:items-start' : ''}`}>
        {/* Debtor queue table */}
        <div className={`bg-card rounded-xl shadow-card border border-border min-w-0 ${isWide && selectedId ? 'xl:flex-1' : ''}`}>
          <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-section-header text-foreground">My Debtor Queue</h2>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search phone (e.g. 077…)"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-sm bg-input border border-border rounded-lg w-52 focus:outline-none focus:ring-2 focus:ring-ring/50 placeholder:text-muted-foreground"
                />
              </div>
              <select
                value={filterClient}
                onChange={(e) => setFilterClient(e.target.value)}
                className="text-sm bg-input border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring/50"
              >
                <option value="All">All Clients</option>
                {clients.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-table-cell">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  {[
                    { key: 'name', label: 'Debtor Name' },
                    { key: 'client', label: 'Client' },
                    { key: 'loanRef', label: 'Loan Ref' },
                    { key: 'balance', label: 'Balance' },
                    { key: 'lastDisposition', label: 'Last Disp.' },
                    { key: 'lastCallDate', label: 'Last Call' },
                    { key: 'naCount', label: 'NA Count' },
                    { key: 'actions', label: '' },
                  ].map((col) => (
                    <th
                      key={`th-${col.key}`}
                      className={`px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap ${col.key !== 'actions' ? 'cursor-pointer hover:text-foreground select-none' : ''}`}
                      onClick={() => col.key !== 'actions' && toggleSort(col.key)}
                    >
                      <span className="flex items-center gap-1">
                        {col.label}
                        {col.key !== 'actions' && <ArrowUpDown size={11} className={sortField === col.key ? 'text-primary' : 'text-muted'} />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading
                  ? Array.from({ length: 8 }).map((_, i) => <TableRowSkeleton key={`skel-${i}`} cols={8} />)
                  : paged.map((debtor) => (
                    <tr
                      key={debtor.id}
                      className={`border-b border-border/60 hover:bg-secondary/40 transition-colors group ${selectedId === debtor.id ? 'bg-primary/5' : ''}`}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {debtor.isStale && (
                            <AlertTriangle size={13} className="text-negative shrink-0" title="Stale — 5+ consecutive NA" />
                          )}
                          {debtor.isPTP && (
                            <span className="w-1.5 h-1.5 rounded-full bg-positive shrink-0" title="Active PTP" />
                          )}
                          <span className="font-medium text-foreground">{debtor.name}</span>
                        </div>
                        <a
                          href={`tel:${toDialFormat(debtor.phone)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-muted-foreground mt-0.5 hover:text-primary hover:underline block w-fit"
                        >
                          {debtor.phone}
                        </a>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Badge variant={clientBadgeVariant(debtor.client)}>{debtor.client}</Badge>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-mono-data text-xs text-muted-foreground">{debtor.loanRef}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-tabular font-semibold text-foreground text-sm">{formatUGX(debtor.balance)}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {debtor.lastDisposition ? (
                          <DispositionBadge code={debtor.lastDisposition} color={dispositionColor(debtor.lastDisposition)} />
                        ) : (
                          <span className="text-xs text-muted-foreground">No calls yet</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-muted-foreground">{formatDate(debtor.lastCallDate)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`font-tabular text-sm font-semibold ${debtor.naCount >= 5 ? 'text-negative' : debtor.naCount >= 3 ? 'text-warning' : 'text-muted-foreground'}`}>
                          {debtor.naCount} / 5
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <a
                            href={`tel:${toDialFormat(debtor.phone)}`}
                            onClick={(e) => e.stopPropagation()}
                            className="p-1.5 rounded-md hover:bg-primary/10 hover:text-primary transition-colors text-muted-foreground"
                            title="Call this debtor"
                          >
                            <Phone size={15} />
                          </a>
                          <button
                            onClick={(e) => { e.stopPropagation(); openDebtor(debtor.id); }}
                            className={`p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground ${selectedId === debtor.id ? 'bg-primary/10 text-primary' : ''}`}
                            title="View debtor details"
                          >
                            <ChevronRight size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>

          {!isLoading && sorted.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-sm text-muted-foreground">No debtors match your search.</p>
            </div>
          )}

          {/* Pagination */}
          <div className="px-5 py-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span>Showing {sorted.length === 0 ? 0 : pageStart + 1}-{Math.min(pageStart + PAGE_SIZE, sorted.length)} of {sorted.length} debtors</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                aria-label="Previous page"
              >
                <ChevronLeft size={15} />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((pg) => pg === 1 || pg === totalPages || Math.abs(pg - page) <= 1)
                .reduce<number[]>((acc, pg) => {
                  if (acc.length > 0 && pg - acc[acc.length - 1] > 1) acc.push(-1); // ellipsis marker
                  acc.push(pg);
                  return acc;
                }, [])
                .map((pg, i) =>
                  pg === -1 ? (
                    <span key={`ellipsis-${i}`} className="px-1 text-muted-foreground">…</span>
                  ) : (
                    <button
                      key={`page-${pg}`}
                      onClick={() => setPage(pg)}
                      className={`w-7 h-7 rounded-md text-xs font-medium transition-colors ${pg === page ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary text-muted-foreground'}`}
                    >
                      {pg}
                    </button>
                  )
                )}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                aria-label="Next page"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        </div>

        {isWide && selectedId && (
          <>
            {!isMaximized && (
              <div
                onMouseDown={startResize}
                title="Drag to resize"
                className="hidden xl:flex w-2.5 shrink-0 self-stretch items-center justify-center cursor-col-resize rounded-full hover:bg-primary/15 transition-colors group"
              >
                <GripVertical size={14} className="text-muted-foreground/60 group-hover:text-primary transition-colors" />
              </div>
            )}
            {/* Detail split panel — same DebtorDetailContent the standalone page renders,
                embedded inline instead of navigated to. @container lets the panel's own
                internal layout (see DebtorDetailContent) respond to its actual rendered
                width instead of the browser viewport — the fixed 50/50 split used to leave
                the disposition grid and call-notes box cramped even on wide screens, since
                Tailwind's xl:/2xl: breakpoints only ever look at viewport width. */}
            <div
              className="@container xl:sticky xl:top-6 xl:self-start xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto bg-card rounded-xl shadow-card border border-border p-5 shrink-0 xl:w-auto"
              style={isWide ? { width: isMaximized ? 'min(1400px, 92vw)' : `${panelWidth}px` } : undefined}
            >
              <div className="flex justify-end mb-1">
                <button
                  onClick={() => setIsMaximized((m) => !m)}
                  title={isMaximized ? 'Restore panel size' : 'Maximize panel'}
                  className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                >
                  {isMaximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </button>
              </div>
              <DebtorDetailContent
                embedded
                debtorId={selectedId}
                onClose={() => router.push('/my-queue')}
                onPrev={prevId ? () => router.push(`/my-queue?selected=${prevId}`, { scroll: false }) : undefined}
                onNext={nextId ? () => router.push(`/my-queue?selected=${nextId}`, { scroll: false }) : undefined}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
