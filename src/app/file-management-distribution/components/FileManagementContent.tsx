'use client';

import React, { useEffect, useState } from 'react';
import { FolderOpen, Upload, CheckCircle, Clock, Users, ChevronRight, FileText, Layers, UserPlus, Pencil, Trash2, Undo2, RefreshCcw } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import Toggle from '@/components/ui/Toggle';
import EmptyState from '@/components/ui/EmptyState';
import Fab from '@/components/ui/Fab';
import ListToolbar from '@/components/ui/ListToolbar';
import ResponsiveList from '@/components/ui/ResponsiveList';
import InlineEditCell from '@/components/ui/InlineEditCell';
import ViewToggle from '@/components/ui/ViewToggle';

import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { useClients } from '@/lib/use-clients';
import { clientBadgeVariant } from '@/lib/client-badge';
import { useViewMode } from '@/lib/use-view-mode';
import { useCachedQuery } from '@/lib/use-cached-query';
import { useOfflineGuard } from '@/lib/use-offline-guard';

interface FileRow {
  id: string;
  clientId: string;
  client: string;
  batchLabel: string;
  receivedDate: string;
  isMidMonthTopup: boolean;
  status: 'active' | 'recalled' | 'distributing' | 'pending';
  debtorCount: number;
  assignedCount: number;
  totalBalance: number;
  agentsAllocated: number;
  importStatus: 'queued' | 'processing' | 'complete' | 'failed';
  importError: string | null;
}

interface AgentOption {
  id: string;
  name: string;
  status: string;
  role: string;
}

interface DistributionRow {
  agentId: string;
  agentName: string;
  band0_500k: number;
  band500k_2m: number;
  band2m_5m: number;
  band5m_plus: number;
  total: number;
}

interface ImportFormData {
  clientId: string;
  batchLabel: string;
  receivedDate: string;
  splitMethod: 'balance_range';
}

interface EditFileForm {
  batchLabel: string;
  receivedDate: string;
  isMidMonthTopup: boolean;
}

interface FilePreview {
  headers: string[];
  sampleRows: string[][];
  totalRows: number | null;
  suggested: {
    nameCol?: number;
    firstNameCol?: number;
    lastNameCol?: number;
    middleNameCol?: number;
    phone1Col?: number;
    phone2Col?: number;
    loanRefCol?: number;
    amountOwedCol?: number;
    balanceCol?: number;
  };
}

interface MappingState {
  nameMode: 'single' | 'split';
  nameCol: string;
  firstNameCol: string;
  lastNameCol: string;
  middleNameCol: string;
  phone1Col: string;
  phone2Col: string;
  loanRefCol: string;
  amountOwedCol: string;
  balanceCol: string;
}

const EMPTY_MAPPING: MappingState = {
  nameMode: 'single', nameCol: '', firstNameCol: '', lastNameCol: '', middleNameCol: '',
  phone1Col: '', phone2Col: '', loanRefCol: '', amountOwedCol: '', balanceCol: '',
};

function mappingFromSuggestion(suggested: FilePreview['suggested']): MappingState {
  const s = (n?: number) => (n === undefined ? '' : String(n));
  return {
    nameMode: suggested.nameCol === undefined && suggested.firstNameCol !== undefined ? 'split' : 'single',
    nameCol: s(suggested.nameCol),
    firstNameCol: s(suggested.firstNameCol),
    lastNameCol: s(suggested.lastNameCol),
    middleNameCol: s(suggested.middleNameCol),
    phone1Col: s(suggested.phone1Col),
    phone2Col: s(suggested.phone2Col),
    loanRefCol: s(suggested.loanRefCol),
    amountOwedCol: s(suggested.amountOwedCol),
    balanceCol: s(suggested.balanceCol),
  };
}

function mappingIsComplete(m: MappingState): boolean {
  const hasName = m.nameMode === 'single' ? m.nameCol !== '' : m.firstNameCol !== '' || m.lastNameCol !== '';
  return hasName && m.phone1Col !== '' && m.loanRefCol !== '' && m.amountOwedCol !== '';
}

function buildMappingPayload(m: MappingState) {
  const n = (v: string) => (v === '' ? undefined : Number(v));
  return {
    nameCol: m.nameMode === 'single' ? n(m.nameCol) : undefined,
    firstNameCol: m.nameMode === 'split' ? n(m.firstNameCol) : undefined,
    lastNameCol: m.nameMode === 'split' ? n(m.lastNameCol) : undefined,
    middleNameCol: m.nameMode === 'split' ? n(m.middleNameCol) : undefined,
    phone1Col: n(m.phone1Col),
    phone2Col: n(m.phone2Col),
    loanRefCol: n(m.loanRefCol),
    amountOwedCol: n(m.amountOwedCol),
    balanceCol: n(m.balanceCol),
  };
}

const statusConfig = {
  active: { label: 'Active', variant: 'positive' as const },
  recalled: { label: 'Recalled', variant: 'muted' as const },
  distributing: { label: 'Distributing', variant: 'warning' as const },
  pending: { label: 'Pending Distribution', variant: 'info' as const },
};

// Importing/failed take priority over the usual distribution-status badge — a file
// mid-background-import always reads as "Importing…" regardless of its debtor/assigned
// counts (which are still filling in), not as "Pending Distribution".
function fileStatusBadge(file: FileRow): { label: string; variant: 'positive' | 'muted' | 'warning' | 'info' | 'negative' } {
  // 'queued' means the background worker hasn't picked it up yet (usually a few
  // seconds) — reads the same as 'processing' to an admin watching this list.
  if (file.importStatus === 'queued' || file.importStatus === 'processing') return { label: 'Importing…', variant: 'warning' };
  if (file.importStatus === 'failed') return { label: 'Import Failed', variant: 'negative' };
  return statusConfig[file.status];
}

function formatUGX(amount: number) {
  if (amount >= 1000000000) return `UGX ${(amount / 1000000000).toFixed(2)}B`;
  if (amount >= 1000000) return `UGX ${(amount / 1000000).toFixed(1)}M`;
  return 'UGX ' + amount.toLocaleString('en-UG');
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB');
}

export default function FileManagementContent() {
  const clients = useClients();
  const { blocked: offlineBlocked } = useOfflineGuard();
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [agentsPrechecked, setAgentsPrechecked] = useState(false);
  const [search, setSearch] = useState('');
  const [filterClient, setFilterClient] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [viewMode, setViewMode] = useViewMode('viewMode:files');
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [distributionFileId, setDistributionFileId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isDistributing, setIsDistributing] = useState(false);
  const [rebalanceAgentId, setRebalanceAgentId] = useState('');
  const [isRebalancing, setIsRebalancing] = useState(false);
  const [isMidMonth, setIsMidMonth] = useState(false);
  const [selectedUploadFile, setSelectedUploadFile] = useState<globalThis.File | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [mapping, setMapping] = useState<MappingState>(EMPTY_MAPPING);
  const [editingFile, setEditingFile] = useState<FileRow | null>(null);
  const [isSavingFile, setIsSavingFile] = useState(false);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ImportFormData>({
    defaultValues: { clientId: '', batchLabel: '', receivedDate: '', splitMethod: 'balance_range' },
  });

  const editForm = useForm<EditFileForm>({
    defaultValues: { batchLabel: '', receivedDate: '', isMidMonthTopup: false },
  });

  const { data: filesData, refetch: refetchFiles } = useCachedQuery<{ files: FileRow[] }>('/api/files');
  const files = filesData?.files ?? [];

  // Large imports finish in the background (see POST /api/files) — poll while any file
  // is still importStatus 'processing' so the row updates on its own once it's done,
  // rather than the admin having to manually refresh to find out.
  useEffect(() => {
    if (!files.some((f) => f.importStatus === 'queued' || f.importStatus === 'processing')) return;
    const id = setInterval(refetchFiles, 4000);
    return () => clearInterval(id);
  }, [files, refetchFiles]);

  const { data: usersData } = useCachedQuery<{ users: AgentOption[] }>('/api/users');
  const agents = (usersData?.users ?? []).filter((u) => u.status === 'active' && (u.role === 'agent' || u.role === 'admin'));

  // Pre-check agents only once, the first time the list becomes available — an admin
  // taking calls is an occasional, deliberate choice per file, not the default (see
  // api/files/[id]/distribute/route.ts). Must not re-run on every cache refresh, or a
  // background revalidation would silently wipe out an admin's in-progress selection.
  useEffect(() => {
    if (agentsPrechecked || agents.length === 0) return;
    setSelectedAgentIds(agents.filter((a) => a.role === 'agent').map((a) => a.id));
    setAgentsPrechecked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, agentsPrechecked]);

  function toggleAgent(agentId: string) {
    setSelectedAgentIds((prev) => (prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]));
  }

  const distributionUrl = distributionFileId ? `/api/files/${distributionFileId}/distribution` : null;
  const { data: distributionPayload } = useCachedQuery<{ distribution: DistributionRow[] }>(distributionUrl);
  const distributionData = distributionPayload?.distribution ?? [];

  const filtered = files.filter(f => {
    const matchSearch = f.batchLabel.toLowerCase().includes(search.toLowerCase()) || f.client.toLowerCase().includes(search.toLowerCase());
    const matchClient = filterClient === 'All' || f.client === filterClient;
    const matchStatus = filterStatus === 'All' || f.status === filterStatus;
    return matchSearch && matchClient && matchStatus;
  });

  const selectedFile = files.find(f => f.id === distributionFileId);

  async function onFileSelected(file: globalThis.File | null) {
    setSelectedUploadFile(file);
    setPreview(null);
    setMapping(EMPTY_MAPPING);
    if (!file) return;

    setIsPreviewing(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/files/preview', { method: 'POST', body: form });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || 'Could not read this file');
        return;
      }
      setPreview(payload);
      setMapping(mappingFromSuggestion(payload.suggested));
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setIsPreviewing(false);
    }
  }

  async function onImport(data: ImportFormData) {
    if (!selectedUploadFile) {
      toast.error('Choose an Excel file to import');
      return;
    }
    if (!mappingIsComplete(mapping)) {
      toast.error('Map Name, Phone, Loan Ref, and Amount Owed to columns in the file before importing');
      return;
    }
    setIsImporting(true);
    try {
      const form = new FormData();
      form.append('file', selectedUploadFile);
      form.append('clientId', data.clientId);
      form.append('batchLabel', data.batchLabel);
      form.append('receivedDate', data.receivedDate);
      form.append('isMidMonthTopup', String(isMidMonth));
      form.append('mapping', JSON.stringify(buildMappingPayload(mapping)));

      const res = await fetch('/api/files', { method: 'POST', body: form });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || 'Import failed');
        return;
      }
      setImportModalOpen(false);
      reset();
      setSelectedUploadFile(null);
      setPreview(null);
      setMapping(EMPTY_MAPPING);
      setIsMidMonth(false);
      refetchFiles();
      setDistributionFileId(payload.file.id);
      toast.success(`File "${data.batchLabel}" queued — importing in the background, ready shortly`);
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setIsImporting(false);
    }
  }

  async function runDistribution(fileId: string) {
    if (selectedAgentIds.length === 0) {
      toast.error('Select at least one agent to distribute to');
      return;
    }
    setIsDistributing(true);
    try {
      const res = await fetch(`/api/files/${fileId}/distribute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentIds: selectedAgentIds }),
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || 'Distribution failed');
        return;
      }
      refetchFiles();
      toast.success(`Distribution triggered — ${payload.assignedCount} debtors split across ${payload.agentsUsed} agents`);
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setIsDistributing(false);
    }
  }

  async function runRebalance(fileId: string) {
    if (!rebalanceAgentId) return;
    setIsRebalancing(true);
    try {
      const res = await fetch(`/api/files/${fileId}/rebalance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newAgentId: rebalanceAgentId }),
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || 'Could not add agent to this file');
        return;
      }
      setRebalanceAgentId('');
      refetchFiles();
      if (payload.reassignedCount > 0) {
        toast.success(payload.message);
      } else {
        toast.info(payload.message);
      }
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setIsRebalancing(false);
    }
  }

  function openEditFile(file: FileRow) {
    setEditingFile(file);
    editForm.reset({
      batchLabel: file.batchLabel,
      receivedDate: file.receivedDate.slice(0, 10),
      isMidMonthTopup: file.isMidMonthTopup,
    });
  }

  async function onSubmitEditFile(data: EditFileForm) {
    if (!editingFile) return;
    setIsSavingFile(true);
    try {
      const res = await fetch(`/api/files/${editingFile.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || 'Could not update file');
        return;
      }
      toast.success(`"${data.batchLabel}" updated`);
      setEditingFile(null);
      refetchFiles();
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setIsSavingFile(false);
    }
  }

  async function toggleRecall(file: FileRow) {
    const nextRecalled = file.status !== 'recalled';
    if (nextRecalled && !window.confirm(`Recall "${file.batchLabel}"? Agents will stop seeing its debtors in their active queue.`)) return;
    const res = await fetch(`/api/files/${file.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isRecalled: nextRecalled }),
    });
    const payload = await res.json();
    if (!res.ok) {
      toast.error(payload.error || 'Could not update file');
      return;
    }
    toast.success(nextRecalled ? `"${file.batchLabel}" recalled` : `"${file.batchLabel}" reactivated`);
    refetchFiles();
  }

  async function deleteFile(file: FileRow) {
    if (!window.confirm(`Permanently delete "${file.batchLabel}"? This deletes all ${file.debtorCount} debtor(s) AND every call logged against them — there is no undo.`)) return;
    const res = await fetch(`/api/files/${file.id}`, { method: 'DELETE' });
    const payload = await res.json();
    if (!res.ok) {
      toast.error(payload.error || 'Could not delete file');
      return;
    }
    toast.success(`"${file.batchLabel}" deleted`);
    if (distributionFileId === file.id) setDistributionFileId(null);
    refetchFiles();
  }

  async function retryImport(file: FileRow) {
    const res = await fetch(`/api/files/${file.id}/import`, { method: 'POST' });
    const payload = await res.json();
    if (!res.ok) {
      toast.error(payload.error || 'Could not retry this import');
      return;
    }
    toast.info(`Retrying import for "${file.batchLabel}"`);
    refetchFiles();
  }

  return (
    <div className="p-6 xl:p-8 2xl:p-10 max-w-screen-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-page-title text-foreground">File Management & Distribution</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage client file batches and agent allocation by balance range</p>
        </div>
        <button
          onClick={() => setImportModalOpen(true)}
          disabled={offlineBlocked}
          title={offlineBlocked ? 'Offline — reconnect to import' : undefined}
          className="hidden lg:flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Upload size={15} />
          Import New File
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Active Files', value: files.filter(f => f.status === 'active').length, icon: FolderOpen, color: 'text-primary' },
          { label: 'Total Debtors', value: files.reduce((s, f) => s + f.debtorCount, 0).toLocaleString(), icon: Users, color: 'text-info' },
          { label: 'Pending Distribution', value: files.filter(f => f.status === 'pending').length, icon: Clock, color: 'text-warning' },
          { label: 'Mid-Month Top-ups', value: files.filter(f => f.isMidMonthTopup).length, icon: Layers, color: 'text-positive' },
        ].map((stat) => (
          <div key={`stat-${stat.label}`} className="bg-card rounded-xl border border-border shadow-card p-4 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg bg-secondary flex items-center justify-center shrink-0 ${stat.color}`}>
              <stat.icon size={18} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">{stat.label}</p>
              <p className="font-tabular font-bold text-lg text-foreground">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 2xl:grid-cols-3 gap-6">
        {/* File list */}
        <div className="xl:col-span-2 2xl:col-span-2 bg-card rounded-xl shadow-card border border-border">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-section-header text-foreground">Client File Batches</h2>
            <ListToolbar
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search files…"
              filters={[
                {
                  key: 'client', value: filterClient, onChange: setFilterClient,
                  options: [{ value: 'All', label: 'All Clients' }, ...clients.map((c) => ({ value: c.name, label: c.name }))],
                },
                {
                  key: 'status', value: filterStatus, onChange: setFilterStatus,
                  options: [
                    { value: 'All', label: 'All Statuses' },
                    { value: 'active', label: 'Active' },
                    { value: 'pending', label: 'Pending' },
                    { value: 'distributing', label: 'Distributing' },
                    { value: 'recalled', label: 'Recalled' },
                  ],
                },
              ]}
              action={<ViewToggle value={viewMode} onChange={setViewMode} />}
            />
          </div>

          <div className={viewMode === 'deck' ? 'p-4' : 'p-4 md:p-0'}>
            <ResponsiveList
              items={filtered}
              keyFor={(file) => file.id}
              viewMode={viewMode}
              deckColumns="sm:grid-cols-2 xl:grid-cols-3"
              renderTableHead={() => (
                <tr className="border-b border-border bg-secondary/30">
                  {['Batch Label', 'Client', 'Received', 'Debtors', 'Total Balance', 'Agents', 'Status', ''].map((col) => (
                    <th key={`fth-${col}`} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              )}
              renderTableRow={(file) => {
                const sc = fileStatusBadge(file);
                return (
                  <tr
                    className={`border-b border-border/60 hover:bg-secondary/40 transition-colors group cursor-pointer ${distributionFileId === file.id ? 'bg-primary/5' : ''}`}
                    onClick={() => setDistributionFileId(file.id)}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <FileText size={14} className="text-muted-foreground shrink-0" />
                        <div onClick={(e) => e.stopPropagation()}>
                          <InlineEditCell
                            value={file.batchLabel}
                            disabled={offlineBlocked}
                            onSave={async (next) => {
                              const res = await fetch(`/api/files/${file.id}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ batchLabel: next }),
                              });
                              const payload = await res.json();
                              if (!res.ok) { toast.error(payload.error || 'Could not update batch label'); return; }
                              refetchFiles();
                            }}
                          />
                          {file.isMidMonthTopup && (
                            <span className="text-xs text-positive font-semibold">Mid-month top-up</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge variant={clientBadgeVariant(file.client)}>
                        {file.client}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-muted-foreground">{formatDate(file.receivedDate)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-tabular font-semibold text-foreground">{file.debtorCount.toLocaleString()}</span>
                      {file.assignedCount < file.debtorCount && (
                        <span className="text-xs text-warning ml-1">({file.debtorCount - file.assignedCount} unassigned)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-tabular text-sm text-foreground">{formatUGX(file.totalBalance)}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-tabular text-sm text-foreground">{file.agentsAllocated}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge variant={sc.variant}>{sc.label}</Badge>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          className="p-1.5 rounded-md hover:bg-primary/10 text-primary transition-colors"
                          title="View distribution"
                          onClick={(e) => { e.stopPropagation(); setDistributionFileId(file.id); }}
                        >
                          <ChevronRight size={15} />
                        </button>
                        {file.importStatus === 'failed' && (
                          <button
                            className="p-1.5 rounded-md hover:bg-primary/10 text-primary transition-colors disabled:opacity-40"
                            title={offlineBlocked ? 'Offline — reconnect to retry' : 'Retry import'}
                            disabled={offlineBlocked}
                            onClick={(e) => { e.stopPropagation(); retryImport(file); }}
                          >
                            <RefreshCcw size={14} />
                          </button>
                        )}
                        <button
                          className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground disabled:opacity-40"
                          title={offlineBlocked ? 'Offline — reconnect to edit' : 'Edit'}
                          disabled={offlineBlocked}
                          onClick={(e) => { e.stopPropagation(); openEditFile(file); }}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground disabled:opacity-40"
                          title={offlineBlocked ? 'Offline — reconnect' : (file.status === 'recalled' ? 'Reactivate' : 'Recall')}
                          disabled={offlineBlocked}
                          onClick={(e) => { e.stopPropagation(); toggleRecall(file); }}
                        >
                          <Undo2 size={14} />
                        </button>
                        <button
                          className="p-1.5 rounded-md hover:bg-[var(--negative-bg)] hover:text-negative transition-colors text-muted-foreground disabled:opacity-40"
                          title={offlineBlocked ? 'Offline — reconnect to delete' : 'Delete'}
                          disabled={offlineBlocked}
                          onClick={(e) => { e.stopPropagation(); deleteFile(file); }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }}
              renderCard={(file) => {
                const sc = fileStatusBadge(file);
                return (
                  <div
                    onClick={() => setDistributionFileId(file.id)}
                    className={`bg-card border border-border rounded-xl p-4 shadow-card cursor-pointer ${distributionFileId === file.id ? 'ring-2 ring-primary/40' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText size={14} className="text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium text-foreground font-mono-data text-xs truncate">{file.batchLabel}</p>
                          {file.isMidMonthTopup && <span className="text-xs text-positive font-semibold">Mid-month top-up</span>}
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-muted-foreground shrink-0" />
                    </div>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <Badge variant={clientBadgeVariant(file.client)}>{file.client}</Badge>
                      <Badge variant={sc.variant}>{sc.label}</Badge>
                      <span className="text-xs text-muted-foreground">{formatDate(file.receivedDate)}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                      <div>
                        <span className="text-muted-foreground block">Debtors</span>
                        <span className="font-tabular font-semibold text-foreground">{file.debtorCount.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Balance</span>
                        <span className="font-tabular font-semibold text-foreground">{formatUGX(file.totalBalance)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Agents</span>
                        <span className="font-tabular font-semibold text-foreground">{file.agentsAllocated}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 mt-3 pt-3 border-t border-border/60" onClick={(e) => e.stopPropagation()}>
                      {file.importStatus === 'failed' && (
                        <button className="p-1.5 rounded-md hover:bg-primary/10 text-primary transition-colors disabled:opacity-40" title={offlineBlocked ? 'Offline — reconnect to retry' : 'Retry import'} disabled={offlineBlocked} onClick={() => retryImport(file)}>
                          <RefreshCcw size={14} />
                        </button>
                      )}
                      <button className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground disabled:opacity-40" title={offlineBlocked ? 'Offline — reconnect to edit' : 'Edit'} disabled={offlineBlocked} onClick={() => openEditFile(file)}>
                        <Pencil size={14} />
                      </button>
                      <button className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground disabled:opacity-40" title={offlineBlocked ? 'Offline — reconnect' : (file.status === 'recalled' ? 'Reactivate' : 'Recall')} disabled={offlineBlocked} onClick={() => toggleRecall(file)}>
                        <Undo2 size={14} />
                      </button>
                      <button className="p-1.5 rounded-md hover:bg-[var(--negative-bg)] hover:text-negative transition-colors text-muted-foreground disabled:opacity-40" title={offlineBlocked ? 'Offline — reconnect to delete' : 'Delete'} disabled={offlineBlocked} onClick={() => deleteFile(file)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              }}
            />
          </div>

          {filtered.length === 0 && (
            <EmptyState
              icon={FolderOpen}
              title="No files found"
              description="No client file batches match your current filters. Import a new file to get started."
              action={
                <button
                  onClick={() => setImportModalOpen(true)}
                  disabled={offlineBlocked}
                  title={offlineBlocked ? 'Offline — reconnect to import' : undefined}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Upload size={14} />
                  Import New File
                </button>
              }
            />
          )}
        </div>

        {/* Distribution panel */}
        <div className="xl:col-span-1 2xl:col-span-1 space-y-4">
          {selectedFile ? (
            <div className="bg-card rounded-xl shadow-card border border-border">
              <div className="px-5 py-4 border-b border-border">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-section-header text-foreground">Agent Distribution</h3>
                    <p className="text-xs text-muted-foreground mt-0.5 font-mono-data">{selectedFile.batchLabel}</p>
                  </div>
                  <Badge variant={fileStatusBadge(selectedFile).variant}>
                    {fileStatusBadge(selectedFile).label}
                  </Badge>
                </div>

                {/* Balance band legend */}
                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  {[
                    { label: '≤ 500K', className: 'balance-band-easy text-xs px-2 py-1 rounded-md font-medium' },
                    { label: '500K–2M', className: 'balance-band-medium text-xs px-2 py-1 rounded-md font-medium' },
                    { label: '2M–5M', className: 'balance-band-hard text-xs px-2 py-1 rounded-md font-medium' },
                    { label: '5M+', className: 'bg-[#FEF2F2] text-negative text-xs px-2 py-1 rounded-md font-medium' },
                  ].map((band) => (
                    <span key={`band-${band.label}`} className={band.className}>{band.label}</span>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-secondary/30">
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Agent</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-muted-foreground">≤500K</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-muted-foreground">500K–2M</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-muted-foreground">2M–5M</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-muted-foreground">5M+</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-muted-foreground">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {distributionData.map((row) => (
                      <tr key={row.agentId} className="border-b border-border/60 hover:bg-secondary/30 transition-colors">
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-foreground text-xs">{row.agentName}</p>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="balance-band-easy px-1.5 py-0.5 rounded font-tabular font-semibold">{row.band0_500k}</span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="balance-band-medium px-1.5 py-0.5 rounded font-tabular font-semibold">{row.band500k_2m}</span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="balance-band-hard px-1.5 py-0.5 rounded font-tabular font-semibold">{row.band2m_5m}</span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="bg-[#FEF2F2] text-negative px-1.5 py-0.5 rounded font-tabular font-semibold">{row.band5m_plus}</span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="font-tabular font-bold text-foreground">{row.total}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-secondary/40 border-t border-border">
                      <td className="px-3 py-2 text-xs font-bold text-foreground">Totals</td>
                      <td className="px-3 py-2 text-center font-tabular font-bold text-foreground">
                        {distributionData.reduce((s, r) => s + r.band0_500k, 0)}
                      </td>
                      <td className="px-3 py-2 text-center font-tabular font-bold text-foreground">
                        {distributionData.reduce((s, r) => s + r.band500k_2m, 0)}
                      </td>
                      <td className="px-3 py-2 text-center font-tabular font-bold text-foreground">
                        {distributionData.reduce((s, r) => s + r.band2m_5m, 0)}
                      </td>
                      <td className="px-3 py-2 text-center font-tabular font-bold text-foreground">
                        {distributionData.reduce((s, r) => s + r.band5m_plus, 0)}
                      </td>
                      <td className="px-3 py-2 text-center font-tabular font-bold text-foreground">
                        {distributionData.reduce((s, r) => s + r.total, 0)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {(selectedFile.status === 'pending' || selectedFile.status === 'distributing') && (
                <div className="p-4 border-t border-border space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs font-semibold text-foreground">Agents for this file</p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setSelectedAgentIds(agents.map((a) => a.id))}
                          className="text-xs text-primary hover:underline"
                        >
                          All
                        </button>
                        <button
                          onClick={() => setSelectedAgentIds([])}
                          className="text-xs text-muted-foreground hover:underline"
                        >
                          None
                        </button>
                      </div>
                    </div>
                    <div className="max-h-40 overflow-y-auto scrollbar-thin border border-border rounded-lg divide-y divide-border">
                      {agents.map((agent) => (
                        <label key={agent.id} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-secondary/40 transition-colors">
                          <input
                            type="checkbox"
                            checked={selectedAgentIds.includes(agent.id)}
                            onChange={() => toggleAgent(agent.id)}
                            className="accent-primary"
                          />
                          <span className="flex-1 text-foreground truncate">{agent.name}</span>
                          {agent.role === 'admin' && (
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-info bg-[var(--info-bg)] px-1.5 py-0.5 rounded-full">Admin</span>
                          )}
                        </label>
                      ))}
                      {agents.length === 0 && (
                        <p className="px-3 py-3 text-xs text-muted-foreground text-center">No active agents yet — add one under Admin → Users.</p>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{selectedAgentIds.length} of {agents.length} agents selected</p>
                  </div>
                  <button
                    onClick={() => runDistribution(selectedFile.id)}
                    disabled={isDistributing || selectedAgentIds.length === 0 || offlineBlocked}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60"
                  >
                    <Users size={15} />
                    {isDistributing ? 'Distributing…' : 'Run Auto-Distribution'}
                  </button>
                  <p className="text-xs text-muted-foreground text-center">Splits debtors by balance range across the agents selected above</p>
                </div>
              )}

              {selectedFile.status === 'active' && (
                <div className="p-4 border-t border-border space-y-2">
                  <p className="text-xs font-semibold text-foreground">Add an agent to this file</p>
                  <p className="text-xs text-muted-foreground">
                    For an agent joining after distribution already ran. Pulls debtors from the current
                    roster — never-called accounts first, then called-but-uncollected — leaving accounts
                    that already have a payment untouched, and keeps the roster balanced as it goes.
                  </p>
                  <div className="flex items-center gap-2">
                    <select
                      value={rebalanceAgentId}
                      onChange={(e) => setRebalanceAgentId(e.target.value)}
                      className="flex-1 text-sm bg-input border border-border rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-ring/50"
                    >
                      <option value="">Select agent…</option>
                      {agents
                        .filter((a) => !distributionData.some((row) => row.agentId === a.id))
                        .map((a) => <option key={a.id} value={a.id}>{a.name}{a.role === 'admin' ? ' (Admin)' : ''}</option>)}
                    </select>
                    <button
                      onClick={() => runRebalance(selectedFile.id)}
                      disabled={!rebalanceAgentId || isRebalancing || offlineBlocked}
                      className="flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60 whitespace-nowrap"
                    >
                      <UserPlus size={15} />
                      {isRebalancing ? 'Adding…' : 'Add'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-card rounded-xl shadow-card border border-border p-8 text-center">
              <Layers size={32} className="text-muted mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">Select a file</p>
              <p className="text-xs text-muted-foreground mt-1">Click any file row to view its agent distribution breakdown</p>
            </div>
          )}
        </div>
      </div>

      <Fab onClick={() => setImportModalOpen(true)} label="Import New File" icon={Upload} disabled={offlineBlocked} />

      {/* Import Modal */}
      <Modal
        open={importModalOpen}
        onClose={() => { setImportModalOpen(false); reset(); setSelectedUploadFile(null); setPreview(null); setMapping(EMPTY_MAPPING); setIsMidMonth(false); }}
        title="Import New Client File"
        subtitle="Upload an Excel file and configure how debtors are split across agents"
        size="lg"
        footer={
          <>
            <button
              type="button"
              onClick={() => { setImportModalOpen(false); reset(); setSelectedUploadFile(null); setPreview(null); setMapping(EMPTY_MAPPING); setIsMidMonth(false); }}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              form="import-form"
              type="submit"
              disabled={isImporting || isPreviewing || !preview || !mappingIsComplete(mapping) || offlineBlocked}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100"
            >
              {isImporting ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>Importing…</span>
                </>
              ) : (
                <>
                  <Upload size={15} />
                  <span>Import & Queue Distribution</span>
                </>
              )}
            </button>
          </>
        }
      >
        <form id="import-form" onSubmit={handleSubmit(onImport)} className="space-y-5">
          {/* File upload zone */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              Excel File <span className="text-negative">*</span>
            </label>
            <p className="text-xs text-muted-foreground">Upload the file received from the client — any column headers are fine, you&apos;ll confirm what maps to what below.</p>
            <label className="block border-2 border-dashed border-border rounded-xl p-8 text-center hover:border-primary/50 transition-colors cursor-pointer bg-secondary/20">
              <input
                type="file"
                accept=".xlsx,.xlsb,.csv"
                className="sr-only"
                onChange={(e) => onFileSelected(e.target.files?.[0] ?? null)}
              />
              <Upload size={24} className="text-muted-foreground mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground">
                {selectedUploadFile ? selectedUploadFile.name : 'Click to browse for a file'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Accepts .xlsx, .xlsb, or .csv files up to 50MB</p>
              <span className="inline-block mt-3 px-3 py-1.5 text-xs font-semibold text-primary border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors">
                Browse Files
              </span>
            </label>
          </div>

          {isPreviewing && (
            <p className="text-sm text-muted-foreground">Reading columns…</p>
          )}

          {preview && (
            <div className="space-y-4 p-4 bg-secondary/30 rounded-xl border border-border">
              <div>
                <p className="text-sm font-semibold text-foreground">Map Columns</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {preview.totalRows !== null
                    ? `${preview.totalRows.toLocaleString()} row(s) detected.`
                    : 'Showing a sample — the full row count is confirmed during import.'}{' '}
                  Matched what we could recognize — confirm or fix anything below before importing.
                </p>
              </div>

              {/* Name */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground uppercase tracking-wide">Name <span className="text-negative">*</span></label>
                  <div className="flex items-center gap-1 text-xs">
                    <button type="button" onClick={() => setMapping((m) => ({ ...m, nameMode: 'single' }))} className={`px-2 py-0.5 rounded-full ${mapping.nameMode === 'single' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>One column</button>
                    <button type="button" onClick={() => setMapping((m) => ({ ...m, nameMode: 'split' }))} className={`px-2 py-0.5 rounded-full ${mapping.nameMode === 'split' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>First / Last</button>
                  </div>
                </div>
                {mapping.nameMode === 'single' ? (
                  <select
                    value={mapping.nameCol}
                    onChange={(e) => setMapping((m) => ({ ...m, nameCol: e.target.value }))}
                    className="w-full px-3 py-2 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
                  >
                    <option value="">Select column…</option>
                    {preview.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </select>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {(['firstNameCol', 'lastNameCol', 'middleNameCol'] as const).map((field, idx) => (
                      <select
                        key={field}
                        value={mapping[field]}
                        onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}
                        className="w-full px-2 py-2 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
                      >
                        <option value="">{['First…', 'Last…', 'Middle (optional)…'][idx]}</option>
                        {preview.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                      </select>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {([
                  ['phone1Col', 'Phone', true],
                  ['phone2Col', 'Phone 2 (optional)', false],
                  ['loanRefCol', 'Loan Ref', true],
                  ['amountOwedCol', 'Amount Owed', true],
                ] as const).map(([field, label, required]) => (
                  <div key={field} className="space-y-1">
                    <label className="text-xs font-semibold text-foreground uppercase tracking-wide">{label}{required && <span className="text-negative"> *</span>}</label>
                    <select
                      value={mapping[field]}
                      onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}
                      className="w-full px-3 py-2 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
                    >
                      <option value="">{required ? 'Select column…' : 'Not in this file'}</option>
                      {preview.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground uppercase tracking-wide">Current Balance (optional)</label>
                <p className="text-xs text-muted-foreground">Only if the file has a separate current-outstanding figure — otherwise balance starts equal to Amount Owed.</p>
                <select
                  value={mapping.balanceCol}
                  onChange={(e) => setMapping((m) => ({ ...m, balanceCol: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
                >
                  <option value="">Same as Amount Owed</option>
                  {preview.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </select>
              </div>

              {preview.sampleRows.length > 0 && (
                <div className="overflow-x-auto scrollbar-thin border border-border rounded-lg bg-card">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-secondary/40">
                        {preview.headers.map((h, i) => (
                          <th key={i} className="px-2 py-1.5 text-left font-semibold text-muted-foreground whitespace-nowrap">{h || `Column ${i + 1}`}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sampleRows.map((row, ri) => (
                        <tr key={ri} className="border-b border-border/60 last:border-0">
                          {row.map((cell, ci) => (
                            <td key={ci} className="px-2 py-1.5 whitespace-nowrap text-foreground">{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Client */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">
                Client <span className="text-negative">*</span>
              </label>
              <select
                className={`w-full px-3 py-2.5 text-sm bg-input border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 ${errors.clientId ? 'border-negative' : 'border-border'}`}
                {...register('clientId', { required: 'Select a client' })}
              >
                <option value="">Select client…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {errors.clientId && <p className="text-xs text-negative">{errors.clientId.message}</p>}
            </div>

            {/* Received date */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">
                Date Received <span className="text-negative">*</span>
              </label>
              <input
                type="date"
                className={`w-full px-3 py-2.5 text-sm bg-input border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 ${errors.receivedDate ? 'border-negative' : 'border-border'}`}
                {...register('receivedDate', { required: 'Enter the date the file was received' })}
              />
              {errors.receivedDate && <p className="text-xs text-negative">{errors.receivedDate.message}</p>}
            </div>
          </div>

          {/* Batch label */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              Batch Label <span className="text-negative">*</span>
            </label>
            <p className="text-xs text-muted-foreground">A unique name for this batch, e.g. KCB-Aug-2026-Batch1</p>
            <input
              type="text"
              placeholder="e.g. KCB-Aug-2026-Batch1"
              className={`w-full px-3 py-2.5 text-sm bg-input border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 font-mono-data ${errors.batchLabel ? 'border-negative' : 'border-border'}`}
              {...register('batchLabel', { required: 'Enter a batch label' })}
            />
            {errors.batchLabel && <p className="text-xs text-negative">{errors.batchLabel.message}</p>}
          </div>

          {/* Mid-month top-up toggle */}
          <div className="flex items-start gap-3 p-4 bg-secondary/40 rounded-lg border border-border">
            <Toggle
              checked={isMidMonth}
              onChange={setIsMidMonth}
              size="md"
            />
            <div>
              <p className="text-sm font-medium text-foreground">Mid-Month Top-Up</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Enable if this is a supplemental batch added mid-month. New debtors will be merged into the existing active file and distributed using the same balance-range split — no manual re-splitting required.
              </p>
            </div>
          </div>

          {/* Distribution method */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">Distribution Method</label>
            <p className="text-xs text-muted-foreground">How debtors will be split across agents</p>
            <div className="grid grid-cols-1 gap-2">
              <label className="flex items-start gap-3 p-3 rounded-lg border-2 border-primary bg-primary/5 cursor-pointer">
                <input type="radio" value="balance_range" defaultChecked className="mt-0.5 accent-primary" {...register('splitMethod')} />
                <div>
                  <p className="text-sm font-semibold text-foreground">Balance Range Split</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Debtors split into 4 bands (≤500K, 500K–2M, 2M–5M, 5M+) and distributed evenly across agents so each agent receives a comparable mix of easier and harder accounts.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Info box */}
          <div className="flex items-start gap-2 p-3 bg-[var(--info-bg)] border border-[#BFDBFE] rounded-lg text-xs text-info">
            <CheckCircle size={13} className="mt-0.5 shrink-0" />
            <span>Call history is preserved on reassignment. If an agent leaves mid-file, their debtors transfer to another agent with full call logs intact.</span>
          </div>
        </form>
      </Modal>

      {/* Edit File */}
      <Modal
        open={!!editingFile}
        onClose={() => setEditingFile(null)}
        title="Edit File"
        subtitle={editingFile ? `${editingFile.client} — ${editingFile.debtorCount.toLocaleString()} debtor(s)` : undefined}
        footer={
          <>
            <button
              onClick={() => setEditingFile(null)}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              form="edit-file-form"
              type="submit"
              disabled={isSavingFile || offlineBlocked}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition-all disabled:opacity-60"
            >
              {isSavingFile ? 'Saving…' : 'Save Changes'}
            </button>
          </>
        }
      >
        <form id="edit-file-form" onSubmit={editForm.handleSubmit(onSubmitEditFile)} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">Batch Label <span className="text-negative">*</span></label>
            <input
              className={`w-full px-3 py-2.5 text-sm bg-input border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 ${editForm.formState.errors.batchLabel ? 'border-negative' : 'border-border'}`}
              {...editForm.register('batchLabel', { required: 'Enter a batch label' })}
            />
            {editForm.formState.errors.batchLabel && <p className="text-xs text-negative">{editForm.formState.errors.batchLabel.message}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">Date Received</label>
            <input
              type="date"
              className="w-full px-3 py-2.5 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
              {...editForm.register('receivedDate')}
            />
          </div>
          <label className="flex items-center gap-2.5 text-sm text-foreground cursor-pointer">
            <input type="checkbox" className="accent-primary" {...editForm.register('isMidMonthTopup')} />
            Mid-month top-up
          </label>
          <p className="text-xs text-muted-foreground">
            Client (<span className="font-medium text-foreground">{editingFile?.client}</span>) can&apos;t be changed —
            delete and re-import under the correct client if this was imported wrong.
          </p>
        </form>
      </Modal>
    </div>
  );
}