'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Phone, AlertTriangle, WifiOff, ChevronRight, ChevronLeft, Search, ArrowUpDown, Wifi } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import DispositionBadge from '@/components/ui/DispositionBadge';
import { TableRowSkeleton } from '@/components/ui/LoadingSkeleton';
import { useOnlineStatus, usePendingSyncCount } from '@/lib/use-offline';
import { clientBadgeVariant } from '@/lib/client-badge';
import { useClients } from '@/lib/use-clients';
import { useIsWide } from '@/lib/use-media-query';
import DebtorDetailContent from '@/app/debtor-detail-call-logging/components/DebtorDetailContent';

interface DebtorRow {
  id: string;
  name: string;
  phone: string;
  loanRef: string;
  amountOwed: number;
  balance: number;
  client: string;
  lastDisposition: string | null;
  lastCallDate: string | null;
  naCount: number;
  isStale: boolean;
  isPTP: boolean;
  activePTP: { amount: number; date: string } | null;
}

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
  const [debtorQueue, setDebtorQueue] = useState<DebtorRow[]>([]);
  const [search, setSearch] = useState('');
  const [filterClient, setFilterClient] = useState('All');
  const [isLoading, setIsLoading] = useState(true);
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [dispositionCodes, setDispositionCodes] = useState<DispositionCodeOption[]>([]);
  const isOnline = useOnlineStatus();
  const pendingSync = usePendingSyncCount();

  const dispositionColor = (code: string) => dispositionCodes.find((d) => d.code === code)?.color ?? '#64748B';

  useEffect(() => {
    let cancelled = false;
    fetch('/api/debtors?scope=mine')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setDebtorQueue(data.debtors ?? []);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    fetch('/api/disposition-codes')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setDispositionCodes(data.codes ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = debtorQueue.filter((d) => {
    const matchSearch = d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.loanRef.toLowerCase().includes(search.toLowerCase()) ||
      d.phone.includes(search);
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

      <div className={`grid grid-cols-1 gap-6 ${isWide && selectedId ? 'xl:grid-cols-2' : ''}`}>
        {/* Debtor queue table */}
        <div className="bg-card rounded-xl shadow-card border border-border">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-section-header text-foreground">My Debtor Queue</h2>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search name, ref, phone…"
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
                          href={`tel:${debtor.phone}`}
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
                            href={`tel:${debtor.phone}`}
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
          /* Detail split panel — same DebtorDetailContent the standalone page renders,
             embedded inline instead of navigated to. */
          <div className="xl:sticky xl:top-6 xl:self-start xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto bg-card rounded-xl shadow-card border border-border p-5">
            <DebtorDetailContent
              embedded
              debtorId={selectedId}
              onClose={() => router.push('/my-queue')}
              onPrev={prevId ? () => router.push(`/my-queue?selected=${prevId}`, { scroll: false }) : undefined}
              onNext={nextId ? () => router.push(`/my-queue?selected=${nextId}`, { scroll: false }) : undefined}
            />
          </div>
        )}
      </div>
    </div>
  );
}
