'use client';

import React, { useEffect, useState } from 'react';
import { Phone, Users, TrendingUp } from 'lucide-react';
import { useClients } from '@/lib/use-clients';

interface AgentOption {
  id: string;
  name: string;
  role: string;
  status: string;
}

interface CoverageRow {
  agentId: string;
  name: string;
  role: string;
  status: string;
  assignedCount: number;
  contactedCount: number;
  coverageRate: number;
  callsCount: number;
  ptpsCount: number;
}

interface TeamCoverageSectionProps {
  agents: AgentOption[];
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function TeamCoverageSection({ agents }: TeamCoverageSectionProps) {
  const clients = useClients();
  const [dateFrom, setDateFrom] = useState(isoDate(new Date()));
  const [dateTo, setDateTo] = useState(isoDate(new Date()));
  const [filterAgent, setFilterAgent] = useState('All');
  const [filterClient, setFilterClient] = useState('All');
  const [rows, setRows] = useState<CoverageRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    const params = new URLSearchParams({ from: dateFrom, to: dateTo });
    if (filterAgent !== 'All') params.set('agentId', filterAgent);
    if (filterClient !== 'All') params.set('clientId', filterClient);

    fetch(`/api/team/agent-coverage?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setRows(d.agents ?? []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, filterAgent, filterClient]);

  const totalCalls = rows.reduce((s, r) => s + r.callsCount, 0);
  const totalContacted = rows.reduce((s, r) => s + r.contactedCount, 0);
  const totalAssigned = rows.reduce((s, r) => s + r.assignedCount, 0);
  const avgCoverage = totalAssigned > 0 ? Math.round((totalContacted / totalAssigned) * 100) : 0;

  return (
    <div className="bg-card rounded-xl shadow-card border border-border">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-section-header text-foreground">Team Coverage</h2>
          <p className="text-xs text-muted-foreground mt-0.5">How much of each agent&apos;s book got worked, over any period you pick</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
          <select
            value={filterAgent}
            onChange={(e) => setFilterAgent(e.target.value)}
            className="text-sm bg-input border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring/50"
          >
            <option value="All">All Agents</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select
            value={filterClient}
            onChange={(e) => setFilterClient(e.target.value)}
            className="text-sm bg-input border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring/50"
          >
            <option value="All">All Clients</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {/* Backing metrics for the selected period/filters */}
      <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
        {[
          { label: 'Calls', value: totalCalls.toLocaleString(), icon: Phone },
          { label: 'Debtors Contacted', value: totalContacted.toLocaleString(), icon: Users },
          { label: 'Avg. Coverage', value: `${avgCoverage}%`, icon: TrendingUp },
        ].map((stat) => (
          <div key={stat.label} className="px-5 py-3 flex items-center gap-2.5">
            <stat.icon size={15} className="text-muted-foreground shrink-0" />
            <div>
              <p className="font-tabular font-bold text-sm text-foreground">{stat.value}</p>
              <p className="text-[11px] text-muted-foreground">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/30">
              {['Agent', 'Assigned', 'Contacted', 'Coverage', 'Calls', 'PTPs'].map((col) => (
                <th key={col} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">No activity for this period/filter.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.agentId} className="hover:bg-secondary/40 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-foreground">{r.name}</span>
                      {r.role === 'admin' && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-info bg-[var(--info-bg)] px-1.5 py-0.5 rounded-full shrink-0">Admin</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap font-tabular text-muted-foreground">{r.assignedCount}</td>
                  <td className="px-4 py-3 whitespace-nowrap font-tabular text-muted-foreground">{r.contactedCount}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2 min-w-[120px]">
                      <div className="flex-1 bg-secondary h-1.5 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-positive" style={{ width: `${Math.min(100, r.coverageRate)}%` }} />
                      </div>
                      <span className="font-tabular text-xs font-semibold text-foreground w-9 text-right">{r.coverageRate}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap font-tabular font-semibold text-foreground">{r.callsCount}</td>
                  <td className="px-4 py-3 whitespace-nowrap font-tabular text-positive">{r.ptpsCount}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
