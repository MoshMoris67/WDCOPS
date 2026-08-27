'use client';

import React from 'react';
import { Phone, TrendingUp, Clock, RefreshCw, WifiOff, Calendar, Wifi } from 'lucide-react';
import dynamic from 'next/dynamic';
import KPICard from './KPICard';
import { useOnlineStatus, usePendingSyncCount } from '@/lib/use-offline';
import { useDebtorQueue } from '@/lib/use-debtor-queue';
import { useCachedQuery } from '@/lib/use-cached-query';
import { toDialFormat } from '@/lib/phone';

const DispositionChart = dynamic(() => import('./DispositionChart'), { ssr: false });
const DailyCallsTrend = dynamic(() => import('./DailyCallsTrend'), { ssr: false });

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

interface FileBreakdownRow {
  fileId: string;
  batchLabel: string;
  clientName: string;
  totalCollected: number;
  myCollected: number;
}

interface DashboardSummary {
  callsToday: number;
  contactRate: number;
  totalAssigned: number;
  contacted: number;
  dispositionBreakdownToday: { code: string; count: number }[];
  dailyTrend: { date: string; count: number }[];
  fileBreakdown: FileBreakdownRow[];
}

function formatUGX(amount: number) {
  if (amount >= 1000000) return `UGX ${(amount / 1000000).toFixed(1)}M`;
  return 'UGX ' + amount.toLocaleString('en-UG');
}

export default function AgentDashboardContent() {
  // Only activePTP is needed here (for the KPI cards) — the full queue table moved to
  // /my-queue (AgentQueueContent), which reads this same cached queue itself.
  const { debtors: debtorQueue } = useDebtorQueue();
  const { data: summary } = useCachedQuery<DashboardSummary>('/api/dashboard/summary?scope=mine');
  const { data: codesData } = useCachedQuery<{ codes: DispositionCodeOption[] }>('/api/disposition-codes');
  const dispositionCodes = codesData?.codes ?? [];
  const isOnline = useOnlineStatus();
  const pendingSync = usePendingSyncCount();

  const todayIso = new Date().toISOString().slice(0, 10);
  const ptpDueToday = debtorQueue.filter(d => d.activePTP?.date?.slice(0, 10) === todayIso).length;
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
          <h1 className="text-page-title text-foreground">Dashboard</h1>
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
        {/* File coverage — same visual language as KPICard, plus an actual progress bar
            (mirrors ClientCard's Recovery Progress bar) so "so far contacted, out of what's
            assigned" reads as real, filling progress rather than just a bare percentage. */}
        <div className="bg-card border border-[#BBF7D0] rounded-xl shadow-card p-5 flex flex-col gap-3 hover:shadow-card-hover transition-shadow duration-200">
          <div className="flex items-start justify-between">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-[var(--positive-bg)] text-positive">
              <TrendingUp size={18} />
            </div>
          </div>
          <div>
            <p className="text-card-label text-muted-foreground uppercase tracking-wider mb-1">File Coverage</p>
            <p className="font-tabular font-bold text-hero-value text-positive">{summary?.contactRate ?? 0}%</p>
            <p className="text-xs text-muted-foreground mt-1">{summary?.contacted ?? 0} of {summary?.totalAssigned ?? 0} contacted</p>
          </div>
          <div className="w-full bg-secondary h-1.5 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-positive transition-all duration-500"
              style={{ width: `${Math.min(100, summary?.contactRate ?? 0)}%` }}
            />
          </div>
        </div>
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

      {/* My collections per file */}
      {summary && summary.fileBreakdown.length > 0 && (
        <div className="bg-card rounded-xl shadow-card border border-border">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="text-section-header text-foreground">My Collections by File</h3>
            <p className="text-xs text-muted-foreground mt-0.5">What you've personally recovered on each file you're assigned to, against the file's total</p>
          </div>
          <div className="divide-y divide-border">
            {summary.fileBreakdown.map((f) => {
              const pct = f.totalCollected > 0 ? Math.round((f.myCollected / f.totalCollected) * 100) : 0;
              return (
                <div key={f.fileId} className="px-5 py-3.5">
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{f.batchLabel}</p>
                      <p className="text-xs text-muted-foreground">{f.clientName}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-tabular font-semibold text-foreground">{formatUGX(f.myCollected)}</p>
                      <p className="text-xs text-muted-foreground font-tabular">of {formatUGX(f.totalCollected)} total</p>
                    </div>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
                  href={`tel:${toDialFormat(cb.phone)}`}
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
    </div>
  );
}
