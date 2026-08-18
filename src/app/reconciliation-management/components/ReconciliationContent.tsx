'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCcw, Upload, CheckCircle, Clock, AlertCircle, BarChart2, Eye,  } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import EmptyState from '@/components/ui/EmptyState';
import Fab from '@/components/ui/Fab';
import ListToolbar from '@/components/ui/ListToolbar';
import ResponsiveList from '@/components/ui/ResponsiveList';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { useClients } from '@/lib/use-clients';
import { clientBadgeVariant } from '@/lib/client-badge';

interface ReconRow {
  id: string;
  client: string;
  fileId: string | null;
  batchLabel: string | null;
  type: 'full' | 'partial';
  receivedAt: string;
  processedAt: string | null;
  recordCount: number;
  updatedCount: number;
  newAccountsCount: number;
  status: 'processed' | 'pending' | 'failed';
  totalAmountUpdated: number;
  errorSummary: string | null;
}

interface AffectedDebtor {
  id: string;
  name: string;
  loanRef: string;
  oldBalance: number;
  newBalance: number;
  paid: number;
}

interface FileOption { id: string; batchLabel: string; clientId: string }

interface UploadFormData {
  clientId: string;
  fileId: string;
  reconciliationType: 'full' | 'partial';
  receivedDate: string;
  receivedTime: string;
  notes: string;
}

const statusConfig = {
  processed: { label: 'Processed', variant: 'positive' as const, icon: CheckCircle },
  pending: { label: 'Pending', variant: 'warning' as const, icon: Clock },
  failed: { label: 'Failed — Ref mismatch', variant: 'negative' as const, icon: AlertCircle },
};

function formatUGX(amount: number) {
  if (amount >= 1000000) return `UGX ${(amount / 1000000).toFixed(1)}M`;
  return 'UGX ' + amount.toLocaleString('en-UG');
}

function formatDateTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ReconciliationContent() {
  const [reconciliations, setReconciliations] = useState<ReconRow[]>([]);
  const [affectedDebtors, setAffectedDebtors] = useState<AffectedDebtor[]>([]);
  const clients = useClients();
  const [files, setFiles] = useState<FileOption[]>([]);
  const [search, setSearch] = useState('');
  const [filterClient, setFilterClient] = useState('All');
  const [filterType, setFilterType] = useState('All');
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedReconId, setSelectedReconId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedUploadFile, setSelectedUploadFile] = useState<globalThis.File | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<UploadFormData>({
    defaultValues: { clientId: '', fileId: '', reconciliationType: 'partial', receivedDate: '', receivedTime: '', notes: '' },
  });

  const loadReconciliations = useCallback(async () => {
    const res = await fetch('/api/reconciliations');
    const data = await res.json();
    setReconciliations(data.reconciliations ?? []);
  }, []);

  useEffect(() => {
    loadReconciliations();
    fetch('/api/files').then((r) => r.json()).then((d) => setFiles(d.files ?? []));
  }, [loadReconciliations]);

  useEffect(() => {
    if (!selectedReconId) {
      setAffectedDebtors([]);
      return;
    }
    fetch(`/api/reconciliations/${selectedReconId}/affected-debtors`)
      .then((r) => r.json())
      .then((d) => setAffectedDebtors(d.affectedDebtors ?? []));
  }, [selectedReconId, reconciliations]);

  const selectedRecon = reconciliations.find(r => r.id === selectedReconId);
  const selectedType = watch('reconciliationType');
  const watchedClientId = watch('clientId');

  const filtered = reconciliations.filter(r => {
    const matchSearch = (r.batchLabel ?? '').toLowerCase().includes(search.toLowerCase()) || r.client.toLowerCase().includes(search.toLowerCase());
    const matchClient = filterClient === 'All' || r.client === filterClient;
    const matchType = filterType === 'All' || r.type === filterType;
    return matchSearch && matchClient && matchType;
  });

  async function onUpload(data: UploadFormData) {
    if (!selectedUploadFile) {
      toast.error('Choose a reconciliation file to upload');
      return;
    }
    setIsUploading(true);
    try {
      const form = new FormData();
      form.append('file', selectedUploadFile);
      form.append('clientId', data.clientId);
      if (data.fileId) form.append('fileId', data.fileId);
      form.append('reconciliationType', data.reconciliationType);
      form.append('receivedDate', data.receivedDate);
      form.append('receivedTime', data.receivedTime);
      form.append('notes', data.notes);

      const res = await fetch('/api/reconciliations', { method: 'POST', body: form });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || 'Could not log this reconciliation');
        return;
      }
      setUploadModalOpen(false);
      reset();
      setSelectedUploadFile(null);
      await loadReconciliations();
      setSelectedReconId(payload.reconciliation.id);
      const newAccountsCount = payload.reconciliation.newAccountsCount ?? 0;
      toast.success(
        `${data.reconciliationType === 'full' ? 'Full' : 'Partial'} reconciliation logged — ${payload.reconciliation.updatedCount} debtor(s) updated` +
        (newAccountsCount > 0 ? `, ${newAccountsCount} new account(s) added and distributed` : '')
      );
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setIsUploading(false);
    }
  }

  async function processRecon(id: string) {
    setProcessingId(id);
    const request = fetch(`/api/reconciliations/${id}/process`, { method: 'POST' })
      .then(async (res) => {
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || 'Processing failed');
        await loadReconciliations();
        return payload;
      })
      .finally(() => setProcessingId(null));

    toast.promise(request, {
      loading: 'Processing reconciliation…',
      success: 'Reconciliation processed — balances updated',
      error: (e) => e.message || 'Processing failed — check loan reference matching',
    });
  }

  const totalProcessed = reconciliations.filter(r => r.status === 'processed').length;
  const totalPending = reconciliations.filter(r => r.status === 'pending').length;
  const totalFailed = reconciliations.filter(r => r.status === 'failed').length;
  const totalAmountRecovered = reconciliations.filter(r => r.status === 'processed').reduce((s, r) => s + r.totalAmountUpdated, 0);

  return (
    <div className="p-6 xl:p-8 2xl:p-10 max-w-screen-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-page-title text-foreground">Reconciliation Management</h1>
          <p className="text-sm text-muted-foreground mt-1">Log and process client reconciliation events — full and partial formats supported</p>
        </div>
        <button
          onClick={() => setUploadModalOpen(true)}
          className="hidden lg:flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 active:scale-95 transition-all"
        >
          <Upload size={15} />
          Log New Reconciliation
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Processed', value: totalProcessed, icon: CheckCircle, color: 'text-positive', bg: 'bg-[var(--positive-bg)]' },
          { label: 'Pending Processing', value: totalPending, icon: Clock, color: 'text-warning', bg: 'bg-[var(--warning-bg)]' },
          { label: 'Failed / Error', value: totalFailed, icon: AlertCircle, color: 'text-negative', bg: 'bg-[var(--negative-bg)]' },
          { label: 'Total Recovered — All Clients', value: formatUGX(totalAmountRecovered), icon: BarChart2, color: 'text-primary', bg: 'bg-[var(--info-bg)]' },
        ].map((stat) => (
          <div key={`recon-stat-${stat.label}`} className="bg-card rounded-xl border border-border shadow-card p-4 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${stat.bg} ${stat.color}`}>
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
        {/* Reconciliation log table */}
        <div className="xl:col-span-2 2xl:col-span-2 bg-card rounded-xl shadow-card border border-border">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-section-header text-foreground">Reconciliation Log</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Every reconciliation event per client — nothing silently lost</p>
            </div>
            <ListToolbar
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search client, batch…"
              filters={[
                {
                  key: 'client', value: filterClient, onChange: setFilterClient,
                  options: [{ value: 'All', label: 'All Clients' }, ...clients.map((c) => ({ value: c.name, label: c.name }))],
                },
                {
                  key: 'type', value: filterType, onChange: setFilterType,
                  options: [{ value: 'All', label: 'All Types' }, { value: 'full', label: 'Full' }, { value: 'partial', label: 'Partial' }],
                },
              ]}
            />
          </div>

          <div className="p-4 md:p-0">
            <ResponsiveList
              items={filtered}
              keyFor={(recon) => recon.id}
              renderTableHead={() => (
                <tr className="border-b border-border bg-secondary/30">
                  {['Client', 'Batch', 'Type', 'Records', 'Updated', 'Amount', 'Received', 'Status', ''].map((col) => (
                    <th key={`rth-${col}`} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              )}
              renderTableRow={(recon) => {
                const sc = statusConfig[recon.status as keyof typeof statusConfig];
                return (
                  <tr
                    className={`border-b border-border/60 hover:bg-secondary/40 transition-colors group cursor-pointer ${selectedReconId === recon.id ? 'bg-primary/5' : ''}`}
                    onClick={() => setSelectedReconId(recon.id)}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge variant={clientBadgeVariant(recon.client)}>
                        {recon.client}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-mono-data text-xs text-muted-foreground">{recon.batchLabel}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${recon.type === 'full' ? 'bg-[var(--info-bg)] text-info' : 'bg-secondary text-secondary-foreground'}`}>
                        {recon.type === 'full' ? 'Full' : 'Partial'}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-tabular font-semibold text-foreground">{recon.recordCount}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`font-tabular font-semibold ${recon.updatedCount > 0 ? 'text-positive' : 'text-muted-foreground'}`}>
                        {recon.updatedCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-tabular text-sm text-foreground">
                        {recon.totalAmountUpdated > 0 ? formatUGX(recon.totalAmountUpdated) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(recon.receivedAt)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge variant={sc.variant}>{sc.label}</Badge>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {(recon.status === 'pending' || recon.status === 'failed') && (
                          <button
                            onClick={(e) => { e.stopPropagation(); processRecon(recon.id); }}
                            disabled={processingId === recon.id}
                            className="p-1.5 rounded-md hover:bg-primary/10 text-primary transition-colors text-xs font-semibold disabled:opacity-50"
                            title="Process this reconciliation now"
                          >
                            <RefreshCcw size={14} className={processingId === recon.id ? 'animate-spin' : ''} />
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedReconId(recon.id); }}
                          className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground"
                          title="View affected debtors"
                        >
                          <Eye size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }}
              renderCard={(recon) => {
                const sc = statusConfig[recon.status as keyof typeof statusConfig];
                return (
                  <div
                    onClick={() => setSelectedReconId(recon.id)}
                    className={`bg-card border border-border rounded-xl p-4 shadow-card cursor-pointer ${selectedReconId === recon.id ? 'ring-2 ring-primary/40' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <Badge variant={clientBadgeVariant(recon.client)}>{recon.client}</Badge>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${recon.type === 'full' ? 'bg-[var(--info-bg)] text-info' : 'bg-secondary text-secondary-foreground'}`}>
                          {recon.type === 'full' ? 'Full' : 'Partial'}
                        </span>
                      </div>
                      <Eye size={16} className="text-muted-foreground shrink-0" />
                    </div>
                    <p className="font-mono-data text-xs text-muted-foreground mt-2 truncate">{recon.batchLabel}</p>
                    <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                      <div>
                        <span className="text-muted-foreground block">Records</span>
                        <span className="font-tabular font-semibold text-foreground">{recon.recordCount}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Updated</span>
                        <span className={`font-tabular font-semibold ${recon.updatedCount > 0 ? 'text-positive' : 'text-muted-foreground'}`}>{recon.updatedCount}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Amount</span>
                        <span className="font-tabular font-semibold text-foreground">{recon.totalAmountUpdated > 0 ? formatUGX(recon.totalAmountUpdated) : '—'}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/60">
                      <span className="text-xs text-muted-foreground">{formatDateTime(recon.receivedAt)}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant={sc.variant}>{sc.label}</Badge>
                        {(recon.status === 'pending' || recon.status === 'failed') && (
                          <button
                            onClick={(e) => { e.stopPropagation(); processRecon(recon.id); }}
                            disabled={processingId === recon.id}
                            className="p-1.5 rounded-md hover:bg-primary/10 text-primary transition-colors disabled:opacity-50"
                            title="Process this reconciliation now"
                          >
                            <RefreshCcw size={14} className={processingId === recon.id ? 'animate-spin' : ''} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }}
            />
          </div>

          {filtered.length === 0 && (
            <EmptyState
              icon={RefreshCcw}
              title="No reconciliations found"
              description="No reconciliation events match your filters. Log a new reconciliation when a client sends an update."
              action={
                <button
                  onClick={() => setUploadModalOpen(true)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors"
                >
                  <Upload size={14} />
                  Log Reconciliation
                </button>
              }
            />
          )}
        </div>

        {/* Detail panel */}
        <div className="xl:col-span-1 2xl:col-span-1 space-y-4">
          {selectedRecon ? (
            <>
              {/* Summary */}
              <div className="bg-card rounded-xl shadow-card border border-border p-5 space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-section-header text-foreground">Processing Summary</h3>
                    <p className="text-xs text-muted-foreground mt-0.5 font-mono-data">{selectedRecon.batchLabel}</p>
                  </div>
                  <Badge variant={statusConfig[selectedRecon.status as keyof typeof statusConfig].variant}>
                    {statusConfig[selectedRecon.status as keyof typeof statusConfig].label}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Type', value: selectedRecon.type === 'full' ? 'Full Reconciliation' : 'Partial (Paid-Only)' },
                    { label: 'Received', value: formatDateTime(selectedRecon.receivedAt) },
                    { label: 'Processed', value: selectedRecon.processedAt ? formatDateTime(selectedRecon.processedAt) : 'Not yet processed' },
                    { label: 'Records In', value: selectedRecon.recordCount.toString() },
                    { label: 'Debtors Updated', value: selectedRecon.updatedCount.toString() },
                    { label: 'New Accounts Added', value: selectedRecon.newAccountsCount.toString() },
                    { label: 'Amount Recovered', value: selectedRecon.totalAmountUpdated > 0 ? formatUGX(selectedRecon.totalAmountUpdated) : '—' },
                  ].map((item) => (
                    <div key={`sum-${item.label}`}>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">{item.label}</p>
                      <p className="text-sm font-semibold text-foreground">{item.value}</p>
                    </div>
                  ))}
                </div>

                {selectedRecon.newAccountsCount > 0 && (
                  <div className="bg-[var(--positive-bg)] border border-positive/30 rounded-lg p-3 text-xs text-positive">
                    <p className="font-semibold mb-1">{selectedRecon.newAccountsCount} new account(s) detected</p>
                    <p>Rows that didn&apos;t match an existing debtor but carried a name, phone, and amount owed were added as new debtors and auto-distributed across the agents already working this client, weighted by how caught-up each one currently is on their existing list.</p>
                  </div>
                )}

                {selectedRecon.type === 'full' && (
                  <div className="bg-[var(--info-bg)] border border-[#BFDBFE] rounded-lg p-3 text-xs text-info">
                    <p className="font-semibold mb-1">Full Reconciliation</p>
                    <p>System compared all {selectedRecon.recordCount} records against current debtor balances and updated cumulative payments across the entire file.</p>
                  </div>
                )}
                {selectedRecon.type === 'partial' && (
                  <div className="bg-secondary/50 border border-border rounded-lg p-3 text-xs text-muted-foreground">
                    <p className="font-semibold text-foreground mb-1">Partial (Paid-Only)</p>
                    <p>System matched {selectedRecon.recordCount} records by loan reference and phone number. Only those debtors were updated — the rest remain unchanged.</p>
                  </div>
                )}

                {(selectedRecon.status === 'pending' || selectedRecon.status === 'failed') && (
                  <button
                    onClick={() => processRecon(selectedRecon.id)}
                    disabled={processingId === selectedRecon.id}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60"
                  >
                    <RefreshCcw size={15} className={processingId === selectedRecon.id ? 'animate-spin' : ''} />
                    {selectedRecon.status === 'failed' ? 'Retry Processing' : 'Process Now'}
                  </button>
                )}

                {selectedRecon.status === 'failed' && (
                  <div className="bg-[var(--negative-bg)] border border-[#FECACA] rounded-lg p-3 text-xs text-negative">
                    <p className="font-semibold mb-1">Processing Failed</p>
                    <p>{selectedRecon.errorSummary || `Loan reference matching failed for ${selectedRecon.recordCount - selectedRecon.updatedCount} records. Check that the file uses the correct loan reference format before re-uploading.`}</p>
                  </div>
                )}
              </div>

              {/* Affected debtors */}
              {selectedRecon.status === 'processed' && (
                <div className="bg-card rounded-xl shadow-card border border-border">
                  <div className="px-4 py-3 border-b border-border">
                    <h4 className="text-sm font-semibold text-foreground">Affected Debtors</h4>
                    <p className="text-xs text-muted-foreground">{affectedDebtors.length} of {selectedRecon.updatedCount} updated records</p>
                  </div>
                  <div className="divide-y divide-border">
                    {affectedDebtors.map((d) => (
                      <div key={d.id} className="px-4 py-3 hover:bg-secondary/30 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium text-foreground">{d.name}</p>
                            <p className="text-xs font-mono-data text-muted-foreground">{d.loanRef}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-positive font-semibold">−{formatUGX(d.paid)}</p>
                            <p className="text-xs text-muted-foreground">{formatUGX(d.newBalance)} remaining</p>
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 bg-secondary rounded-full overflow-hidden">
                          <div
                            className="h-full bg-positive rounded-full"
                            style={{ width: `${d.oldBalance > 0 ? Math.min(100, Math.round((d.paid / d.oldBalance) * 100)) : 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="bg-card rounded-xl shadow-card border border-border p-8 text-center">
              <RefreshCcw size={32} className="text-muted mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">Select a reconciliation</p>
              <p className="text-xs text-muted-foreground mt-1">Click any row to view processing details and affected debtors</p>
            </div>
          )}
        </div>
      </div>

      <Fab onClick={() => setUploadModalOpen(true)} label="Log New Reconciliation" icon={Upload} />

      {/* Upload Modal */}
      <Modal
        open={uploadModalOpen}
        onClose={() => { setUploadModalOpen(false); reset(); setSelectedUploadFile(null); }}
        title="Log New Reconciliation"
        subtitle="Upload a reconciliation file received from a client and log the event"
        size="lg"
        footer={
          <>
            <button
              type="button"
              onClick={() => { setUploadModalOpen(false); reset(); setSelectedUploadFile(null); }}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              form="recon-upload-form"
              type="submit"
              disabled={isUploading}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100"
            >
              {isUploading ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>Logging…</span>
                </>
              ) : (
                <>
                  <Upload size={15} />
                  <span>Log & Process</span>
                </>
              )}
            </button>
          </>
        }
      >
        <form id="recon-upload-form" onSubmit={handleSubmit(onUpload)} className="space-y-5">
          {/* File upload */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">Reconciliation File <span className="text-negative">*</span></label>
            <p className="text-xs text-muted-foreground">
              Required: Loan Ref or Phone, plus {selectedType === 'full' ? 'Cumulative Paid' : 'Amount Paid'}.
              Rows that don&apos;t match an existing debtor are added as new accounts if the row also has
              Name, Phone, and Amount Owed — so a client can send new accounts and reconciliation in one file.
            </p>
            <label className="block border-2 border-dashed border-border rounded-xl p-6 text-center hover:border-primary/50 transition-colors cursor-pointer bg-secondary/20">
              <input
                type="file"
                accept=".xlsx,.csv"
                className="sr-only"
                onChange={(e) => setSelectedUploadFile(e.target.files?.[0] ?? null)}
              />
              <Upload size={20} className="text-muted-foreground mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground">
                {selectedUploadFile ? selectedUploadFile.name : 'Click to browse for a reconciliation file'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Accepts .xlsx or .csv up to 20MB</p>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">Client <span className="text-negative">*</span></label>
              <select
                className={`w-full px-3 py-2.5 text-sm bg-input border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 ${errors.clientId ? 'border-negative' : 'border-border'}`}
                {...register('clientId', { required: 'Select a client' })}
              >
                <option value="">Select client…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {errors.clientId && <p className="text-xs text-negative">{errors.clientId.message}</p>}
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">File Batch</label>
              <select
                className="w-full px-3 py-2.5 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
                {...register('fileId')}
              >
                <option value="">Not tied to a specific batch…</option>
                {files.filter((f) => !watchedClientId || f.clientId === watchedClientId).map((f) => (
                  <option key={f.id} value={f.id}>{f.batchLabel}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Reconciliation type */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">Reconciliation Type <span className="text-negative">*</span></label>
            <p className="text-xs text-muted-foreground">Select the format this client sent</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { value: 'full', title: 'Full Reconciliation', desc: 'Complete file — system compares all records and updates cumulative payments across the whole batch' },
                { value: 'partial', title: 'Partial (Paid-Only)', desc: 'Only paid accounts — system matches by loan ref or phone and updates only those debtors' },
              ].map((opt) => (
                <label
                  key={`rtype-${opt.value}`}
                  className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${selectedType === opt.value ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'}`}
                >
                  <input type="radio" value={opt.value} className="mt-0.5 accent-primary" {...register('reconciliationType')} />
                  <div>
                    <p className="text-sm font-semibold text-foreground">{opt.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">Date Received <span className="text-negative">*</span></label>
              <input
                type="date"
                className={`w-full px-3 py-2.5 text-sm bg-input border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 ${errors.receivedDate ? 'border-negative' : 'border-border'}`}
                {...register('receivedDate', { required: 'Enter the date received' })}
              />
              {errors.receivedDate && <p className="text-xs text-negative">{errors.receivedDate.message}</p>}
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">Time Received</label>
              <input
                type="time"
                className="w-full px-3 py-2.5 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
                {...register('receivedTime')}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">Notes</label>
            <p className="text-xs text-muted-foreground">Optional — any context about this reconciliation batch</p>
            <textarea
              rows={2}
              placeholder="e.g. Client confirmed this covers all payments received up to 14/08/2026"
              className="w-full px-3 py-2 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 resize-none placeholder:text-muted-foreground"
              {...register('notes')}
            />
          </div>

          <div className="flex items-start gap-2 p-3 bg-[var(--info-bg)] border border-[#BFDBFE] rounded-lg text-xs text-info">
            <RefreshCcw size={13} className="mt-0.5 shrink-0" />
            <span>Processing runs automatically after logging. Agents will see updated balances and a "recently paid" flag on their queue — they never see raw reconciliation data.</span>
          </div>
        </form>
      </Modal>
    </div>
  );
}