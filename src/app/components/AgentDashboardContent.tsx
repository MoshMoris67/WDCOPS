'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Phone, AlertTriangle, TrendingUp, Clock, RefreshCw, WifiOff, ChevronRight, Search, ArrowUpDown, Calendar, Wifi,  } from 'lucide-react';
import dynamic from 'next/dynamic';
import KPICard from './KPICard';
import Badge from '@/components/ui/Badge';
import DispositionBadge from '@/components/ui/DispositionBadge';
import { TableRowSkeleton } from '@/components/ui/LoadingSkeleton';
import { useOnlineStatus, usePendingSyncCount } from '@/lib/use-offline';
import { clientBadgeVariant } from '@/lib/client-badge';
import { useClients } from '@/lib/use-clients';
import { useIsWide } from '@/lib/use-media-query';
import DebtorDetailContent from '@/app/debtor-detail-call-logging/components/DebtorDetailContent';

const DispositionChart = dynamic(() => import('./DispositionChart'), { ssr: false });
const DailyCallsTrend = dynamic(() => import('./DailyCallsTrend'), { ssr: false });

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

// Still example data — the callback scheduler (Phase 2) is what will drive this for real.
const callbacks = [
  { id: 'cb-001', debtorName: 'Auma Grace Lillian', time: '10:30', phone: '+256 785 993 102', client: 'KCB' },
  { id: 'cb-002', debtorName: 'Nansubuga Patience', time: '14:00', phone: '+256 701 556 881', client: 'HFB' },
  { id: 'cb-003', debtorName: 'Ssebulime Peter', time: '15:30', phone: '+256 772 887 342', client: 'KCB' },
];

interface DispositionCodeOption {
  code: string;
  label: string;
  color: string;
}

interface DashboardSummary {
  callsToday: number;
  contactRate: number;
  dispositionBreakdownToday: { code: string; count: number }[];
  dailyTrend: { date: string; count: number }[];
}

function formatUGX(amount: number) {
  return 'UGX ' + amount.toLocaleString('en-UG');
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB');
}

export default function AgentDashboardContent() {
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
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
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
    fetch('/api/dashboard/summary?scope=mine')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setSummary(data);
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
      router.push(`/agent-dashboard?selected=${id}`, { scroll: false });
    } else {
      try {
        sessionStorage.setItem('queue:agent-dashboard', JSON.stringify(sorted.map((d) => d.id)));
      } catch {
        // sessionStorage unavailable (private mode, etc.) — Prev/Next just won't show up
      }
      router.push(`/debtor-detail-call-logging?id=${id}`);
    }
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const ptpDueToday = debtorQueue.filter(d => d.activePTP?.date?.slice(0, 10) === todayIso).length;
  const staleCount = debtorQueue.filter(d => d.isStale).length;
  const todayLabel = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const nowLabel = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const dispositionChartData = (summary?.dispositionBreakdownToday ?? []).map((d) => {
    const known = dispositionCodes.find((c) => c.code === d.code);
    return { code: d.code, label: known?.label ?? d.code, count: d.count, color: known?.color ?? '#94A3B8' };
  });
  const trendChartData = (summary?.dailyTrend ?? []).map((d) => ({
    day: new Date(`${d.date}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
    calls: d.count,
  }));

  return (
    <div className="p-6 xl:p-8 2xl:p-10 max-w-screen-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-page-title text-foreground">Agent Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">{todayLabel} — Uganda Branch</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium ${isOnline ? 'sync-online' : 'sync-offline'}`}>
            {isOnline ? <Wifi size={13} /> : <WifiOff size={13} />}
            <span>{isOnline ? `Synced ${nowLabel}` : `Offline${pendingSync > 0 ? ` — ${pendingSync} pending` : ''}`}</span>
          </div>
        </div>
      </div>

      {/* Offline warning banner */}
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

      {/* KPI Bento Grid — 5 cards: row1: hero(2col)+2regular, row2: 2 regular */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-4 gap-4">
        {/* Hero: Calls Today spans 2 cols */}
        <div className="col-span-1 md:col-span-2 lg:col-span-2 xl:col-span-2 2xl:col-span-2">
          <KPICard
            label="Calls Today"
            value={String(summary?.callsToday ?? 0)}
            subtext={`7-day total: ${(summary?.dailyTrend ?? []).reduce((s, d) => s + d.count, 0)} calls`}
            trend="neutral"
            trendValue=""
            icon={Phone}
            variant="info"
            featured
          />
        </div>
        <KPICard
          label="PTP Due Today"
          value={String(ptpDueToday)}
          subtext="Promise dates matching today"
          trend="neutral"
          trendValue=""
          icon={Clock}
          variant="warning"
        />
        <KPICard
          label="Contact Rate"
          value={`${summary?.contactRate ?? 0}%`}
          subtext="Non-NA dispositions / assigned"
          trend="neutral"
          trendValue=""
          icon={TrendingUp}
          variant="positive"
        />
        <KPICard
          label="Stale Accounts"
          value={String(staleCount)}
          subtext="5+ consecutive NA dispositions"
          trend="neutral"
          trendValue=""
          icon={AlertTriangle}
          variant="negative"
        />
        <KPICard
          label="Pending Sync"
          value={String(pendingSync)}
          subtext={pendingSync > 0 ? 'Saved locally, not sent yet' : 'All logs synced to server'}
          trend="neutral"
          trendValue=""
          icon={RefreshCw}
          variant="default"
        />
      </div>

      {/* Main content row — a queue + detail split panel replaces the right sidebar at
          desktop widths once a debtor is selected, so opening one never navigates the
          queue away; below that width (and with nothing selected) it's the original
          queue + callbacks/charts layout. */}
      <div className={`grid grid-cols-1 gap-6 ${isWide && selectedId ? 'xl:grid-cols-2' : 'lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4'}`}>
        {/* Debtor queue table */}
        <div className={`${isWide && selectedId ? '' : 'lg:col-span-2 xl:col-span-3 2xl:col-span-3'} bg-card rounded-xl shadow-card border border-border`}>
          {/* Table header */}
          <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-section-header text-foreground">My Debtor Queue</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{debtorQueue.length} debtors assigned — sorted by priority</p>
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

          {/* Table */}
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
                  : sorted.map((debtor) => (
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

          {sorted.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-sm text-muted-foreground">No debtors match your search.</p>
            </div>
          )}

          {/* Pagination */}
          <div className="px-5 py-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span>Showing {sorted.length} of {debtorQueue.length} debtors</span>
            <div className="flex items-center gap-1">
              {[1, 2, 3].map((pg) => (
                <button
                  key={`page-${pg}`}
                  className={`w-7 h-7 rounded-md text-xs font-medium transition-colors ${pg === 1 ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary text-muted-foreground'}`}
                >
                  {pg}
                </button>
              ))}
            </div>
          </div>
        </div>

        {isWide && selectedId ? (
          /* Detail split panel — same DebtorDetailContent the standalone page renders,
             embedded inline instead of navigated to. */
          <div className="xl:sticky xl:top-6 xl:self-start xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto bg-card rounded-xl shadow-card border border-border p-5">
            <DebtorDetailContent
              embedded
              debtorId={selectedId}
              onClose={() => router.push('/agent-dashboard')}
              onPrev={prevId ? () => router.push(`/agent-dashboard?selected=${prevId}`, { scroll: false }) : undefined}
              onNext={nextId ? () => router.push(`/agent-dashboard?selected=${nextId}`, { scroll: false }) : undefined}
            />
          </div>
        ) : (
          /* Right panel */
          <div className="flex flex-col gap-4">
            {/* Callbacks today */}
            <div className="bg-card rounded-xl shadow-card border border-border p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Calendar size={15} className="text-primary" />
                  Callbacks Today
                </h3>
                <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">{callbacks.length}</span>
              </div>
              <div className="space-y-2">
                {callbacks.map((cb) => (
                  <div key={cb.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-secondary/50 transition-colors group">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-primary font-mono-data">{cb.time}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{cb.debtorName}</p>
                      <p className="text-xs text-muted-foreground">{cb.client} · {cb.phone}</p>
                    </div>
                    <a
                      href={`tel:${cb.phone}`}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-primary/10 text-primary transition-all"
                      title="Call now"
                    >
                      <Phone size={14} />
                    </a>
                  </div>
                ))}
              </div>
            </div>

            {/* Disposition breakdown chart */}
            <div className="bg-card rounded-xl shadow-card border border-border p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">Today's Dispositions</h3>
              <DispositionChart data={dispositionChartData} />
            </div>

            {/* 7-day trend */}
            <div className="bg-card rounded-xl shadow-card border border-border p-4">
              <h3 className="text-sm font-semibold text-foreground mb-1">7-Day Call Trend</h3>
              <p className="text-xs text-muted-foreground mb-3">Daily call log count</p>
              <DailyCallsTrend data={trendChartData} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}