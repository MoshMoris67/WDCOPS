'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, TrendingUp, AlertTriangle, Wallet, ChevronLeft, ChevronRight } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import ClientCard from '@/components/ui/ClientCard';
import ResponsiveList from '@/components/ui/ResponsiveList';
import ListToolbar from '@/components/ui/ListToolbar';
import InlineEditCell from '@/components/ui/InlineEditCell';
import ViewToggle from '@/components/ui/ViewToggle';
import { toast } from 'sonner';
import { clientBadgeVariant } from '@/lib/client-badge';
import { debtorRowTint } from '@/lib/format-rules';
import { useViewMode } from '@/lib/use-view-mode';
import { useCachedQuery } from '@/lib/use-cached-query';
import { getCached, setCached } from '@/lib/offline-cache';
import { useOfflineGuard } from '@/lib/use-offline-guard';

interface ClientSummary {
  id: string;
  name: string;
  reconciliationType: string;
  debtorCount: number;
  contactRate: number;
  recovered: number;
  totalOwed: number;
  staleCount: number;
  recentFiles: { id: string; batchLabel: string; receivedDate: string }[];
}

interface AgentSummary {
  id: string;
  name: string;
  role: string;
  status: string;
  assignedCount: number;
  callsToday: number;
  ptpsToday: number;
}

interface DebtorRow {
  id: string;
  name: string;
  phone: string;
  loanRef: string;
  balance: number;
  client: string;
  lastDisposition: string | null;
  lastCallDate: string | null;
  naCount: number;
  isStale: boolean;
  recentlyPaid: boolean;
}

interface FileOption {
  id: string;
  clientId: string;
  batchLabel: string;
}

interface AgentPerfRow {
  fileId: string;
  batchLabel: string;
  clientName: string;
  agentId: string;
  agentName: string;
  assignedCount: number;
  recovered: number;
}

interface CommissionBucketRow {
  bucket: string;
  label: string;
  loans: number;
  collections: number;
  companyCommission: number;
  agentCommission: number;
}

interface CommissionAgentRow {
  agentId: string;
  agentName: string;
  loans: number;
  collections: number;
  companyCommission: number;
  agentCommission: number;
}

interface CommissionCard {
  clientId: string;
  clientName: string;
  buckets: CommissionBucketRow[];
  agents: CommissionAgentRow[];
}

const dispositionVariantMap: Record<string, 'cb' | 'ptp' | 'np' | 'na' | 'hu' | 'nb' | 'db' | 'so' | 'os'> = {
  CB: 'cb', PTP: 'ptp', NP: 'np', NA: 'na', HU: 'hu', NB: 'nb', DB: 'db', SO: 'so', OS: 'os',
};

function formatUGX(amount: number) {
  if (amount >= 1000000) return `UGX ${(amount / 1000000).toFixed(1)}M`;
  return 'UGX ' + amount.toLocaleString('en-UG');
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB');
}

export default function TeamDashboardContent() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterClient, setFilterClient] = useState('All');
  const [filterAgent, setFilterAgent] = useState('All');
  const [filterFile, setFilterFile] = useState('All');
  const [viewMode, setViewMode] = useViewMode('viewMode:debtors');

  const [perfClientId, setPerfClientId] = useState('All');
  const [perfFileId, setPerfFileId] = useState('All');
  const [perfAgentId, setPerfAgentId] = useState('All');
  const [commissionCards, setCommissionCards] = useState<CommissionCard[]>([]);

  const { blocked: mutationsBlocked, reason: offlineReason } = useOfflineGuard();

  // Bespoke (not routed through useCachedQuery) because "not authorized" is a real,
  // distinct outcome carried by the response status, not just success/failure — a 403
  // must never be confused with "couldn't reach the server". Still cache-first: render
  // last-known clients/agents instantly, then let a live 403 (if it ever comes back)
  // override that. A network failure with nothing cached just leaves this on "Loading…",
  // which is the honest state for a genuinely first-ever offline visit to this screen.
  const loadOverview = useCallback(async () => {
    const cached = await getCached<{ clients: ClientSummary[]; agents: AgentSummary[] }>('/api/team/overview');
    if (cached) {
      setAuthorized(true);
      setClients(cached.clients ?? []);
      setAgents(cached.agents ?? []);
    }
    try {
      const overviewRes = await fetch('/api/team/overview');
      if (overviewRes.status === 403) {
        setAuthorized(false);
        return;
      }
      const overview = await overviewRes.json();
      setAuthorized(true);
      setClients(overview.clients ?? []);
      setAgents(overview.agents ?? []);
      await setCached('/api/team/overview', overview);
    } catch {
      // Offline — whatever was set from cache above (if anything) stands as-is.
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (authorized === false) router.replace('/agent-dashboard');
  }, [authorized, router]);

  // One request per client (small, fixed-size list) rather than a single combined
  // endpoint — /api/team/commission itself decides per client whether commission
  // tracking is even on (any CommissionRate rows configured; see lib/commission.ts), so
  // most clients resolve to `enabled: false` and are simply left out of the result here.
  useEffect(() => {
    if (!authorized || clients.length === 0) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(clients.map(async (c) => {
        try {
          const res = await fetch(`/api/team/commission?clientId=${c.id}`);
          const payload = await res.json();
          if (!payload.enabled) return null;
          return { clientId: c.id, clientName: c.name, buckets: payload.buckets ?? [], agents: payload.agents ?? [] } as CommissionCard;
        } catch {
          return null;
        }
      }));
      if (!cancelled) setCommissionCards(results.filter((r): r is CommissionCard => r !== null));
    })();
    return () => { cancelled = true; };
  }, [authorized, clients]);

  const { data: filesData } = useCachedQuery<{ files: FileOption[] }>(authorized ? '/api/files' : null);
  const files = filesData?.files ?? [];

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filterClient, filterAgent, filterFile]);

  // Changing the client filter can orphan a previously-selected file that belongs to a
  // different client — clear it rather than silently keeping a mismatched filter applied.
  useEffect(() => {
    if (filterFile !== 'All' && !files.some((f) => f.id === filterFile && (filterClient === 'All' || f.clientId === filterClient))) {
      setFilterFile('All');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterClient]);

  const debtorsUrl = (() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (filterClient !== 'All') params.set('clientId', filterClient);
    if (filterAgent !== 'All') params.set('agentId', filterAgent);
    if (filterFile !== 'All') params.set('fileId', filterFile);
    return `/api/debtors?${params.toString()}`;
  })();
  const {
    data: debtorsData,
    isLoading: debtorsLoading,
    refetch: refetchDebtors,
  } = useCachedQuery<{ debtors: DebtorRow[]; total: number }>(authorized ? debtorsUrl : null);
  const debtors = debtorsData?.debtors ?? [];
  const total = debtorsData?.total ?? 0;

  const perfUrl = (() => {
    const params = new URLSearchParams();
    if (perfClientId !== 'All') params.set('clientId', perfClientId);
    if (perfFileId !== 'All') params.set('fileId', perfFileId);
    if (perfAgentId !== 'All') params.set('agentId', perfAgentId);
    return `/api/team/agent-performance?${params.toString()}`;
  })();
  const {
    data: perfData,
    isLoading: perfLoading,
    refetch: refetchPerf,
  } = useCachedQuery<{ rows: AgentPerfRow[] }>(authorized ? perfUrl : null);
  const perfRows = perfData?.rows ?? [];

  useEffect(() => {
    if (perfFileId !== 'All' && !files.some((f) => f.id === perfFileId && (perfClientId === 'All' || f.clientId === perfClientId))) {
      setPerfFileId('All');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfClientId]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function reassignDebtor(debtor: DebtorRow, agentId: string) {
    const res = await fetch(`/api/debtors/${debtor.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignedAgentId: agentId }),
    });
    const payload = await res.json();
    if (!res.ok) {
      toast.error(payload.error || 'Reassignment failed');
      return;
    }
    toast.success(`${debtor.name} reassigned — call history preserved`);
    await loadOverview();
    refetchDebtors();
    refetchPerf();
  }

  if (authorized === null) {
    return <div className="p-6 xl:p-8 2xl:p-10 max-w-screen-2xl mx-auto"><p className="text-sm text-muted-foreground">Loading…</p></div>;
  }
  if (authorized === false) return null;

  const totalDebtors = clients.reduce((s, c) => s + c.debtorCount, 0);
  const totalRecovered = clients.reduce((s, c) => s + c.recovered, 0);
  const totalOwed = clients.reduce((s, c) => s + c.totalOwed, 0);
  const totalStale = clients.reduce((s, c) => s + c.staleCount, 0);

  return (
    <div>
      {/* Gradient header band */}
      <div className="relative overflow-hidden px-6 xl:px-8 2xl:px-10 py-7" style={{ background: 'linear-gradient(135deg, #0F1C3F 0%, #1D4ED8 130%)' }}>
        <div
          className="absolute -top-24 right-0 w-64 h-64 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.28) 0%, rgba(245,158,11,0) 70%)' }}
        />
        <div className="max-w-screen-2xl mx-auto relative">
          <h1 className="text-2xl font-bold text-white">Team Overview</h1>
          <p className="text-sm text-blue-200 mt-1">Live view across every client file — scoped by file, not by individual, so any admin sees the full picture</p>
        </div>
      </div>

      <div className="p-6 xl:p-8 2xl:p-10 max-w-screen-2xl mx-auto space-y-6">

      {/* Branch-wide KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Debtors', value: totalDebtors.toLocaleString(), icon: Users, from: '#DBEAFE', to: '#EFF6FF', color: '#1D4ED8' },
          { label: 'Recovered', value: formatUGX(totalRecovered), icon: Wallet, from: '#DCFCE7', to: '#F0FDF4', color: '#16A34A' },
          { label: 'Recovery Rate', value: totalOwed > 0 ? `${Math.round((totalRecovered / totalOwed) * 100)}%` : '0%', icon: TrendingUp, from: '#FEF3C7', to: '#FFFBEB', color: '#D97706' },
          { label: 'Stale Accounts', value: String(totalStale), icon: AlertTriangle, from: '#FEE2E2', to: '#FEF2F2', color: '#DC2626' },
        ].map((stat) => (
          <div key={stat.label} className="bg-card rounded-xl border border-border shadow-card p-4 flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: `linear-gradient(135deg, ${stat.from}, ${stat.to})`, color: stat.color }}
            >
              <stat.icon size={18} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">{stat.label}</p>
              <p className="font-tabular font-bold text-lg text-foreground">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Per-client file cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {clients.map((c) => (
          <ClientCard
            key={c.id}
            name={c.name}
            categoryLabel={c.reconciliationType === 'full' ? 'Full Reconciliation' : 'Partial Reconciliation'}
            debtorCount={c.debtorCount}
            contactRate={c.contactRate}
            recovered={c.recovered}
            totalOwed={c.totalOwed}
            staleCount={c.staleCount}
            recentFiles={c.recentFiles}
            onClick={() => router.push(`/reports-client-export?clientId=${c.id}`)}
          />
        ))}
        {clients.length === 0 && (
          <p className="text-sm text-muted-foreground col-span-2">No clients yet — import a file to get started.</p>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Agent performance */}
        <div className="xl:col-span-1 bg-card rounded-xl shadow-card border border-border">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-section-header text-foreground">Agents Today</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{agents.length} agents</p>
          </div>
          <div className="divide-y divide-border max-h-[420px] overflow-y-auto scrollbar-thin">
            {agents.map((a) => (
              <div key={a.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-foreground truncate">{a.name}</p>
                    {a.role === 'admin' && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-info bg-[var(--info-bg)] px-1.5 py-0.5 rounded-full shrink-0">Admin</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{a.assignedCount} assigned</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-tabular text-sm font-semibold text-foreground">{a.callsToday} calls</p>
                  <p className="text-xs text-positive">{a.ptpsToday} PTPs</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Debtor table with reassignment */}
        <div className="xl:col-span-2 bg-card rounded-xl shadow-card border border-border">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-section-header text-foreground">All Debtors</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {debtors.length} of {total.toLocaleString()} debtors
                {mutationsBlocked && <span className="ml-2 text-warning">· {offlineReason.replace('make this change', 'reassign')}</span>}
              </p>
            </div>
            <ListToolbar
              search={debouncedSearch}
              onSearchChange={setDebouncedSearch}
              filters={[
                {
                  key: 'client', value: filterClient, onChange: setFilterClient,
                  options: [{ value: 'All', label: 'All Clients' }, ...clients.map((c) => ({ value: c.id, label: c.name }))],
                },
                {
                  key: 'agent', value: filterAgent, onChange: setFilterAgent,
                  options: [{ value: 'All', label: 'All Agents' }, ...agents.map((a) => ({ value: a.id, label: a.name }))],
                },
                {
                  key: 'file', value: filterFile, onChange: setFilterFile,
                  options: [
                    { value: 'All', label: 'All Files' },
                    ...files
                      .filter((f) => filterClient === 'All' || f.clientId === filterClient)
                      .map((f) => ({ value: f.id, label: f.batchLabel })),
                  ],
                },
              ]}
              action={<ViewToggle value={viewMode} onChange={setViewMode} />}
            />
          </div>
          <div className={viewMode === 'deck' ? 'p-4' : 'p-4 md:p-0'}>
            <ResponsiveList
              items={debtors}
              keyFor={(d) => d.id}
              isLoading={debtorsLoading}
              viewMode={viewMode}
              deckColumns="sm:grid-cols-2"
              emptyState={
                debtorsLoading
                  ? <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
                  : <p className="text-sm text-muted-foreground text-center py-8">No debtors match your filters.</p>
              }
              renderTableHead={() => (
                <tr className="border-b border-border bg-secondary/30">
                  {['Debtor', 'Client', 'Balance', 'Last Disp.', 'Last Call', 'Reassign'].map((col) => (
                    <th key={col} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{col}</th>
                  ))}
                </tr>
              )}
              renderTableRow={(d) => (
                <tr className={`border-b border-border/60 hover:bg-secondary/40 transition-colors ${debtorRowTint({ isStale: d.isStale, balance: d.balance })}`}>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {d.isStale && <AlertTriangle size={12} className="text-negative shrink-0" />}
                      <span className="font-medium text-foreground text-sm">{d.name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{d.loanRef}</p>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Badge variant={clientBadgeVariant(d.client)}>{d.client}</Badge>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap font-tabular text-sm text-foreground">{formatUGX(d.balance)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {d.lastDisposition ? <Badge variant={dispositionVariantMap[d.lastDisposition] || 'default'}>{d.lastDisposition}</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">{formatDate(d.lastCallDate)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <InlineEditCell
                      value=""
                      displayValue="Reassign…"
                      disabled={mutationsBlocked}
                      options={[{ value: '', label: 'Reassign…' }, ...agents.filter((a) => a.status === 'active').map((a) => ({ value: a.id, label: `${a.name}${a.role === 'admin' ? ' (Admin)' : ''} — ${a.assignedCount} assigned` }))]}
                      onSave={async (agentId) => { if (agentId) await reassignDebtor(d, agentId); }}
                    />
                  </td>
                </tr>
              )}
              renderCard={(d) => (
                <div className={`bg-card border border-border rounded-xl p-4 shadow-card ${debtorRowTint({ isStale: d.isStale, balance: d.balance })}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {d.isStale && <AlertTriangle size={12} className="text-negative shrink-0" />}
                        <span className="font-medium text-foreground text-sm truncate">{d.name}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{d.loanRef}</p>
                    </div>
                    <Badge variant={clientBadgeVariant(d.client)}>{d.client}</Badge>
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <div>
                      <span className="font-tabular text-sm text-foreground block">{formatUGX(d.balance)}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(d.lastCallDate)}</span>
                    </div>
                    {d.lastDisposition ? <Badge variant={dispositionVariantMap[d.lastDisposition] || 'default'}>{d.lastDisposition}</Badge> : <span className="text-xs text-muted-foreground">No calls yet</span>}
                  </div>
                  <div className="mt-3 pt-3 border-t border-border/60">
                    <InlineEditCell
                      value=""
                      displayValue="Reassign to another agent…"
                      disabled={mutationsBlocked}
                      options={[{ value: '', label: 'Reassign to another agent…' }, ...agents.filter((a) => a.status === 'active').map((a) => ({ value: a.id, label: `${a.name}${a.role === 'admin' ? ' (Admin)' : ''} — ${a.assignedCount} assigned` }))]}
                      onSave={async (agentId) => { if (agentId) await reassignDebtor(d, agentId); }}
                    />
                  </div>
                </div>
              )}
            />
          </div>
          {totalPages > 1 && (
            <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">Page {page} of {totalPages}</p>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                  aria-label="Previous page"
                >
                  <ChevronLeft size={15} />
                </button>
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
          )}
        </div>
      </div>

      {/* Agent performance per file */}
      <div className="bg-card rounded-xl shadow-card border border-border">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-section-header text-foreground">Agent Performance by File</h2>
            <p className="text-xs text-muted-foreground mt-0.5">How much each agent has recovered, broken down per file</p>
          </div>
          <ListToolbar
            search=""
            onSearchChange={() => {}}
            hideSearch
            filters={[
              {
                key: 'perf-client', value: perfClientId, onChange: setPerfClientId,
                options: [{ value: 'All', label: 'All Clients' }, ...clients.map((c) => ({ value: c.id, label: c.name }))],
              },
              {
                key: 'perf-file', value: perfFileId, onChange: setPerfFileId,
                options: [
                  { value: 'All', label: 'All Files' },
                  ...files
                    .filter((f) => perfClientId === 'All' || f.clientId === perfClientId)
                    .map((f) => ({ value: f.id, label: f.batchLabel })),
                ],
              },
              {
                key: 'perf-agent', value: perfAgentId, onChange: setPerfAgentId,
                options: [{ value: 'All', label: 'All Agents' }, ...agents.map((a) => ({ value: a.id, label: a.name }))],
              },
            ]}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                {['Agent', 'File', 'Client', 'Assigned', 'Collected'].map((col) => (
                  <th key={col} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perfRows.map((r) => (
                <tr key={`${r.fileId}-${r.agentId}`} className="border-b border-border/60 hover:bg-secondary/40 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-foreground">{r.agentName}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-foreground">{r.batchLabel}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Badge variant={clientBadgeVariant(r.clientName)}>{r.clientName}</Badge>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap font-tabular text-sm text-foreground">{r.assignedCount}</td>
                  <td className="px-4 py-3 whitespace-nowrap font-tabular text-sm font-semibold text-positive">{formatUGX(r.recovered)}</td>
                </tr>
              ))}
              {!perfLoading && perfRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">No agent activity matches these filters.</td>
                </tr>
              )}
              {perfLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Commission — one card per client with commission tracking configured */}
      {commissionCards.map((card) => {
        const totalCompany = card.buckets.reduce((s, b) => s + b.companyCommission, 0);
        const totalAgent = card.buckets.reduce((s, b) => s + b.agentCommission, 0);
        return (
          <div key={card.clientId} className="bg-card rounded-xl shadow-card border border-border">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="text-section-header text-foreground">Commission — {card.clientName}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatUGX(totalCompany)} company commission · {formatUGX(totalAgent)} agent commission (20% share)
              </p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-secondary/30">
                      {['Band', 'Loans', 'Collections', 'Company', 'Agent (20%)'].map((col) => (
                        <th key={col} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {card.buckets.map((b) => (
                      <tr key={b.bucket} className="border-b border-border/60">
                        <td className="px-3 py-2 whitespace-nowrap text-sm text-foreground">{b.label}</td>
                        <td className="px-3 py-2 whitespace-nowrap font-tabular text-sm text-foreground">{b.loans}</td>
                        <td className="px-3 py-2 whitespace-nowrap font-tabular text-sm text-foreground">{formatUGX(b.collections)}</td>
                        <td className="px-3 py-2 whitespace-nowrap font-tabular text-sm font-semibold text-positive">{formatUGX(b.companyCommission)}</td>
                        <td className="px-3 py-2 whitespace-nowrap font-tabular text-sm text-foreground">{formatUGX(b.agentCommission)}</td>
                      </tr>
                    ))}
                    {card.buckets.length === 0 && (
                      <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">No priced collections yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-secondary/30">
                      {['Agent', 'Loans', 'Collections', 'Company', 'Agent (20%)'].map((col) => (
                        <th key={col} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {card.agents.map((a) => (
                      <tr key={a.agentId} className="border-b border-border/60">
                        <td className="px-3 py-2 whitespace-nowrap text-sm font-medium text-foreground">{a.agentName}</td>
                        <td className="px-3 py-2 whitespace-nowrap font-tabular text-sm text-foreground">{a.loans}</td>
                        <td className="px-3 py-2 whitespace-nowrap font-tabular text-sm text-foreground">{formatUGX(a.collections)}</td>
                        <td className="px-3 py-2 whitespace-nowrap font-tabular text-sm font-semibold text-positive">{formatUGX(a.companyCommission)}</td>
                        <td className="px-3 py-2 whitespace-nowrap font-tabular text-sm font-semibold text-foreground">{formatUGX(a.agentCommission)}</td>
                      </tr>
                    ))}
                    {card.agents.length === 0 && (
                      <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">No agent has collections priced yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
