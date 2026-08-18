'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Download, Calendar, CheckCircle, Clock, TrendingUp, Users, AlertTriangle,  } from 'lucide-react';
import dynamic from 'next/dynamic';
import Badge from '@/components/ui/Badge';
import DispositionBadge from '@/components/ui/DispositionBadge';
import ResponsiveList from '@/components/ui/ResponsiveList';
import { toast } from 'sonner';
import { useClients } from '@/lib/use-clients';

const ReportDispositionChart = dynamic(() => import('./ReportDispositionChart'), { ssr: false });
const RecoveryRadialChart = dynamic(() => import('./RecoveryRadialChart'), { ssr: false });

interface DispositionCodeOption { code: string; color: string }

interface ReportSummary {
  totalDebtors: number;
  contacted: number;
  ptpCount: number;
  ptpAmount: number;
  recovered: number;
  totalOwed: number;
  staleCount: number;
  dispositions: { code: string; label: string; count: number }[];
  agentSummary: { agentId: string; name: string; calls: number; ptps: number; recovered: number }[];
}

type FrequencyKey = 'daily' | 'weekly' | 'monthly';

const frequencies: { key: FrequencyKey; label: string }[] = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
];

function formatUGX(amount: number) {
  if (amount >= 1000000000) return `UGX ${(amount / 1000000000).toFixed(2)}B`;
  if (amount >= 1000000) return `UGX ${(amount / 1000000).toFixed(1)}M`;
  return 'UGX ' + amount.toLocaleString('en-UG');
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function ReportsContent() {
  const clients = useClients();
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedFrequency, setSelectedFrequency] = useState<FrequencyKey>('daily');
  const [dateFrom, setDateFrom] = useState(isoDate(new Date()));
  const [dateTo, setDateTo] = useState(isoDate(new Date()));
  const [isExporting, setIsExporting] = useState(false);
  const [data, setData] = useState<ReportSummary | null>(null);
  const [lastGenerated, setLastGenerated] = useState<string | null>(null);
  const [dispositionCodes, setDispositionCodes] = useState<DispositionCodeOption[]>([]);

  useEffect(() => {
    fetch('/api/disposition-codes').then((r) => r.json()).then((d) => setDispositionCodes(d.codes ?? []));
  }, []);

  useEffect(() => {
    if (clients.length > 0) setSelectedClientId((prev) => prev || clients[0].id);
  }, [clients]);

  const loadSummary = useCallback(async () => {
    if (!selectedClientId) return;
    const res = await fetch(`/api/reports/summary?clientId=${selectedClientId}&from=${dateFrom}&to=${dateTo}`);
    const payload = await res.json();
    if (res.ok) {
      setData(payload.summary);
      setLastGenerated(new Date().toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
    }
  }, [selectedClientId, dateFrom, dateTo]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const selectedClient = clients.find((c) => c.id === selectedClientId);
  const recoveryPct = data && data.totalOwed > 0 ? Math.round((data.recovered / data.totalOwed) * 100) : 0;
  const contactRate = data && data.totalDebtors > 0 ? Math.round((data.contacted / data.totalDebtors) * 100) : 0;
  const ptpRate = data && data.contacted > 0 ? Math.round((data.ptpCount / data.contacted) * 100) : 0;
  const totalDispositions = data ? data.dispositions.reduce((s, d) => s + d.count, 0) : 0;
  const dispositionsWithColor = data
    ? data.dispositions.map((d) => ({ ...d, color: dispositionCodes.find((c) => c.code === d.code)?.color ?? '#94A3B8' }))
    : [];

  function selectFrequency(freq: FrequencyKey) {
    setSelectedFrequency(freq);
    const today = new Date();
    const from = new Date(today);
    if (freq === 'weekly') from.setDate(from.getDate() - 6);
    if (freq === 'monthly') from.setDate(from.getDate() - 29);
    setDateFrom(isoDate(from));
    setDateTo(isoDate(today));
  }

  async function handleExport() {
    if (!selectedClientId) return;
    setIsExporting(true);
    try {
      const res = await fetch(`/api/reports/export?clientId=${selectedClientId}&frequency=${selectedFrequency}&from=${dateFrom}&to=${dateTo}`);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Export failed');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedClient?.name ?? 'report'}-${selectedFrequency}-${dateFrom}-to-${dateTo}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`${selectedClient?.name} ${selectedFrequency} report exported — check your downloads`);
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="p-6 xl:p-8 2xl:p-10 max-w-screen-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-page-title text-foreground">Reports & Client Export</h1>
          <p className="text-sm text-muted-foreground mt-1">Generate and export client reports — daily, weekly, and monthly Excel formats</p>
        </div>
        <button
          onClick={handleExport}
          disabled={isExporting}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-positive text-white text-sm font-semibold rounded-lg hover:bg-positive/90 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100"
        >
          {isExporting ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span>Generating…</span>
            </>
          ) : (
            <>
              <Download size={15} />
              <span>Export Excel Report</span>
            </>
          )}
        </button>
      </div>

      {/* Controls */}
      <div className="bg-card rounded-xl shadow-card border border-border p-4">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Client selector */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Client</p>
            <div className="flex gap-1">
              {clients.map((c) => (
                <button
                  key={`client-tab-${c.id}`}
                  onClick={() => setSelectedClientId(c.id)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${selectedClientId === c.id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div className="w-px h-8 bg-border" />

          {/* Frequency selector */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Frequency</p>
            <div className="flex gap-1">
              {frequencies.map((f) => (
                <button
                  key={`freq-tab-${f.key}`}
                  onClick={() => selectFrequency(f.key)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${selectedFrequency === f.key ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="w-px h-8 bg-border" />

          {/* Date range */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Date Range</p>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="px-2.5 py-1.5 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
              />
              <span className="text-muted-foreground text-sm">to</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="px-2.5 py-1.5 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
              />
            </div>
          </div>

          <div className="ml-auto">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/50 text-xs text-muted-foreground">
              <Clock size={12} />
              <span>{lastGenerated ? `Last generated: ${lastGenerated}` : 'Generating…'}</span>
            </div>
          </div>
        </div>
      </div>

      {data && (
        <>
          {/* KPI summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-4 gap-4">
            {[
              { label: 'Total Debtors', value: data.totalDebtors.toLocaleString(), icon: Users, sub: `${selectedClient?.name ?? ''} active file`, variant: 'info' as const },
              { label: 'Contact Rate', value: `${contactRate}%`, icon: TrendingUp, sub: `${data.contacted} of ${data.totalDebtors} contacted`, variant: 'positive' as const },
              { label: 'PTP Rate', value: `${ptpRate}%`, icon: CheckCircle, sub: `${data.ptpCount} PTPs · ${formatUGX(data.ptpAmount)} committed`, variant: 'positive' as const },
              { label: 'Stale Accounts', value: String(data.staleCount), icon: AlertTriangle, sub: '5+ consecutive NA dispositions', variant: 'negative' as const },
            ].map((kpi) => (
              <div key={`rpt-kpi-${kpi.label}`} className={`bg-card rounded-xl border shadow-card p-4 ${kpi.variant === 'negative' ? 'border-[#FECACA]' : kpi.variant === 'positive' ? 'border-[#BBF7D0]' : 'border-[#BFDBFE]'}`}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{kpi.label}</p>
                  <kpi.icon size={14} className={kpi.variant === 'negative' ? 'text-negative' : kpi.variant === 'positive' ? 'text-positive' : 'text-info'} />
                </div>
                <p className="font-tabular font-bold text-2xl text-foreground">{kpi.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{kpi.sub}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 2xl:grid-cols-3 gap-6">
            {/* Disposition breakdown table + chart */}
            <div className="xl:col-span-2 2xl:col-span-2 space-y-4">
              {/* Disposition summary */}
              <div className="bg-card rounded-xl shadow-card border border-border">
                <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                  <div>
                    <h2 className="text-section-header text-foreground">Disposition Summary</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">{totalDispositions} total dispositions — {selectedFrequency} period</p>
                  </div>
                  <Badge variant="info">{selectedClient?.name}</Badge>
                </div>

                <div className="p-4">
                  <ReportDispositionChart data={dispositionsWithColor} />
                </div>

                <div className="px-4 pb-4 md:px-0 md:pb-0">
                  <ResponsiveList
                    items={dispositionsWithColor}
                    keyFor={(d) => d.code}
                    renderTableHead={() => (
                      <tr className="border-t border-b border-border bg-secondary/30">
                        {['Code', 'Disposition', 'Count', '% of Total', 'Bar'].map((col) => (
                          <th key={`dth-${col}`} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                            {col}
                          </th>
                        ))}
                      </tr>
                    )}
                    renderTableRow={(d) => {
                      const pct = totalDispositions > 0 ? Math.round((d.count / totalDispositions) * 100) : 0;
                      return (
                        <tr className="border-b border-border/60 hover:bg-secondary/30 transition-colors">
                          <td className="px-4 py-2.5">
                            <DispositionBadge code={d.code} color={d.color} />
                          </td>
                          <td className="px-4 py-2.5 text-sm text-foreground">{d.label}</td>
                          <td className="px-4 py-2.5">
                            <span className="font-tabular font-semibold text-foreground">{d.count}</span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="font-tabular text-sm text-muted-foreground">{pct}%</span>
                          </td>
                          <td className="px-4 py-2.5 w-32">
                            <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: d.color }} />
                            </div>
                          </td>
                        </tr>
                      );
                    }}
                    renderCard={(d) => {
                      const pct = totalDispositions > 0 ? Math.round((d.count / totalDispositions) * 100) : 0;
                      return (
                        <div className="bg-secondary/30 border border-border/60 rounded-lg p-3">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <DispositionBadge code={d.code} color={d.color} />
                            <span className="font-tabular font-semibold text-sm text-foreground">{d.count} · {pct}%</span>
                          </div>
                          <p className="text-xs text-muted-foreground mb-1.5">{d.label}</p>
                          <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: d.color }} />
                          </div>
                        </div>
                      );
                    }}
                  />
                </div>
              </div>

              {/* Agent performance table */}
              <div className="bg-card rounded-xl shadow-card border border-border">
                <div className="px-5 py-4 border-b border-border">
                  <h2 className="text-section-header text-foreground">Agent Performance</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">{selectedFrequency} breakdown per agent on {selectedClient?.name} file</p>
                </div>
                <div className="px-4 pb-4 md:px-0 md:pb-0">
                  <ResponsiveList
                    items={data.agentSummary}
                    keyFor={(agent) => agent.agentId}
                    renderTableHead={() => (
                      <tr className="border-b border-border bg-secondary/30">
                        {['Agent', 'Calls Logged', 'PTPs', 'PTP Rate', 'Recovered', 'Recovery %'].map((col) => (
                          <th key={`ath-${col}`} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                            {col}
                          </th>
                        ))}
                      </tr>
                    )}
                    renderTableRow={(agent) => {
                      const agentPtpRate = agent.calls > 0 ? Math.round((agent.ptps / agent.calls) * 100) : 0;
                      const agentRecoveryPct = data.totalOwed > 0
                        ? Math.round((agent.recovered / (data.totalOwed / data.agentSummary.length)) * 100)
                        : 0;
                      return (
                        <tr className="border-b border-border/60 hover:bg-secondary/30 transition-colors">
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                <span className="text-xs font-bold text-primary">
                                  {agent.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                                </span>
                              </div>
                              <span className="font-medium text-foreground text-sm">{agent.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="font-tabular font-semibold text-foreground">{agent.calls}</span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="font-tabular font-semibold text-positive">{agent.ptps}</span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="font-tabular text-sm text-foreground">{agentPtpRate}%</span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="font-tabular font-semibold text-foreground">{formatUGX(agent.recovered)}</span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
                                <div className="h-full bg-positive rounded-full" style={{ width: `${Math.min(agentRecoveryPct, 100)}%` }} />
                              </div>
                              <span className="font-tabular text-xs text-muted-foreground">{agentRecoveryPct}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    }}
                    renderCard={(agent) => {
                      const agentPtpRate = agent.calls > 0 ? Math.round((agent.ptps / agent.calls) * 100) : 0;
                      const agentRecoveryPct = data.totalOwed > 0
                        ? Math.round((agent.recovered / (data.totalOwed / data.agentSummary.length)) * 100)
                        : 0;
                      return (
                        <div className="bg-secondary/30 border border-border/60 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                              <span className="text-xs font-bold text-primary">{agent.name.split(' ').map(n => n[0]).join('').slice(0, 2)}</span>
                            </div>
                            <span className="font-medium text-foreground text-sm">{agent.name}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <span className="text-muted-foreground">Calls: <span className="font-tabular font-semibold text-foreground">{agent.calls}</span></span>
                            <span className="text-muted-foreground">PTPs: <span className="font-tabular font-semibold text-positive">{agent.ptps}</span> ({agentPtpRate}%)</span>
                            <span className="text-muted-foreground col-span-2">Recovered: <span className="font-tabular font-semibold text-foreground">{formatUGX(agent.recovered)}</span> ({agentRecoveryPct}%)</span>
                          </div>
                        </div>
                      );
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Right panel */}
            <div className="xl:col-span-1 2xl:col-span-1 space-y-4">
              {/* Recovery rate radial */}
              <div className="bg-card rounded-xl shadow-card border border-border p-5">
                <h3 className="text-section-header text-foreground mb-4">Recovery Rate</h3>
                <div className="flex flex-col items-center gap-4">
                  <RecoveryRadialChart percentage={recoveryPct} label={selectedClient?.name ?? ''} />
                  <div className="w-full space-y-2">
                    {[
                      { label: 'Total Owed', value: formatUGX(data.totalOwed), color: 'text-foreground' },
                      { label: 'Recovered', value: formatUGX(data.recovered), color: 'text-positive' },
                      { label: 'Outstanding', value: formatUGX(data.totalOwed - data.recovered), color: 'text-negative' },
                    ].map((item) => (
                      <div key={`rec-${item.label}`} className="flex items-center justify-between py-1.5 border-b border-border/60">
                        <span className="text-xs text-muted-foreground">{item.label}</span>
                        <span className={`font-tabular font-semibold text-sm ${item.color}`}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Export config */}
              <div className="bg-card rounded-xl shadow-card border border-border p-5 space-y-4">
                <h3 className="text-section-header text-foreground">Export Configuration</h3>

                <div className="space-y-3">
                  {[
                    { label: 'Report Template', value: `${selectedClient?.name ?? ''} Standard Format`, editable: false },
                    { label: 'Date Range', value: `${dateFrom} to ${dateTo}`, editable: false },
                    { label: 'Include Agent Breakdown', checked: true },
                    { label: 'Include Disposition Detail', checked: true },
                    { label: 'Include PTP Schedule', checked: true },
                    { label: 'Include Stale Account List', checked: true },
                  ].map((config) => (
                    <div key={`cfg-${'label' in config ? config.label : ''}`} className="flex items-center justify-between gap-2">
                      <span className="text-sm text-foreground">{'label' in config ? config.label : ''}</span>
                      {'checked' in config ? (
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${config.checked ? 'bg-primary border-primary' : 'border-border'}`}>
                          {config.checked && <CheckCircle size={10} className="text-white" />}
                        </div>
                      ) : (
                        <span className="text-xs font-medium text-muted-foreground text-right">{config.value}</span>
                      )}
                    </div>
                  ))}
                </div>

                <div className="pt-2 border-t border-border">
                  <p className="text-xs text-muted-foreground mb-3">
                    Report will be exported as .xlsx matching the {selectedClient?.name} template format. Sent directly to your downloads folder.
                  </p>
                  <button
                    onClick={handleExport}
                    disabled={isExporting}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-positive text-white text-sm font-semibold rounded-lg hover:bg-positive/90 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100"
                  >
                    {isExporting ? (
                      <>
                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span>Generating Excel…</span>
                      </>
                    ) : (
                      <>
                        <Download size={15} />
                        <span>Export {selectedClient?.name} Report</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Schedule */}
              <div className="bg-card rounded-xl shadow-card border border-border p-5 space-y-3">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Calendar size={14} className="text-primary" />
                  Report Schedule
                </h3>
                {[
                  { freq: 'Daily', time: '08:00 EAT', status: 'active', nextRun: 'Tomorrow 08:00' },
                  { freq: 'Weekly', time: 'Mon 07:00 EAT', status: 'active', nextRun: 'Mon 18 Aug 07:00' },
                  { freq: 'Monthly', time: '1st of month 07:00', status: 'active', nextRun: '01 Sep 07:00' },
                ].map((sched) => (
                  <div key={`sched-${sched.freq}`} className="flex items-center justify-between py-2 border-b border-border/60 last:border-0">
                    <div>
                      <p className="text-sm font-medium text-foreground">{sched.freq}</p>
                      <p className="text-xs text-muted-foreground">{sched.time} · Next: {sched.nextRun}</p>
                    </div>
                    <Badge variant="positive" dot>Active</Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}