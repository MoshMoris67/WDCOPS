'use client';

import React, { useEffect, useState } from 'react';
import { RefreshCcw, Upload, CheckCircle, Clock, AlertCircle, BarChart2, Eye, Pencil, Trash2, UserCheck, Search } from 'lucide-react';
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
import { useCachedQuery } from '@/lib/use-cached-query';
import { useOfflineGuard } from '@/lib/use-offline-guard';

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
  notes: string | null;
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

interface EditReconForm {
  receivedDate: string;
  receivedTime: string;
  notes: string;
}

interface DebtorSearchResult {
  id: string;
  name: string;
  loanRef: string;
  client: string;
  balance: number;
}

interface ReconPreview {
  headers: string[];
  sampleRows: string[][];
  totalRows: number | null;
  suggested: {
    loanRefCol?: number;
    phoneCol?: number;
    amountCol?: number;
    nameCol?: number;
    amountOwedCol?: number;
  };
}

interface ReconMappingState {
  loanRefCol: string;
  phoneCol: string;
  amountCol: string;
  nameCol: string;
  amountOwedCol: string;
}

const EMPTY_RECON_MAPPING: ReconMappingState = {
  loanRefCol: '', phoneCol: '', amountCol: '', nameCol: '', amountOwedCol: '',
};

function reconMappingFromSuggestion(suggested: ReconPreview['suggested']): ReconMappingState {
  const s = (n?: number) => (n === undefined ? '' : String(n));
  return {
    loanRefCol: s(suggested.loanRefCol),
    phoneCol: s(suggested.phoneCol),
    amountCol: s(suggested.amountCol),
    nameCol: s(suggested.nameCol),
    amountOwedCol: s(suggested.amountOwedCol),
  };
}

// Mirrors excel.ts's parseReconciliationRows validation: need Loan Ref or Phone to match
// against, plus either an amount column or full Name+Amount Owed for new accounts.
function reconMappingIsComplete(m: ReconMappingState): boolean {
  const hasMatchKey = m.loanRefCol !== '' || m.phoneCol !== '';
  const hasAmount = m.amountCol !== '';
  const hasNewAccountInfo = m.nameCol !== '' && m.amountOwedCol !== '';
  return hasMatchKey && (hasAmount || hasNewAccountInfo);
}

function buildReconMappingPayload(m: ReconMappingState) {
  const n = (v: string) => (v === '' ? undefined : Number(v));
  return {
    loanRefCol: n(m.loanRefCol),
    phoneCol: n(m.phoneCol),
    amountCol: n(m.amountCol),
    nameCol: n(m.nameCol),
    amountOwedCol: n(m.amountOwedCol),
  };
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
  const clients = useClients();
  const { blocked: offlineBlocked } = useOfflineGuard();
  const [search, setSearch] = useState('');
  const [filterClient, setFilterClient] = useState('All');
  const [filterType, setFilterType] = useState('All');
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedReconId, setSelectedReconId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedUploadFile, setSelectedUploadFile] = useState<globalThis.File | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [reconPreview, setReconPreview] = useState<ReconPreview | null>(null);
  const [reconMapping, setReconMapping] = useState<ReconMappingState>(EMPTY_RECON_MAPPING);
  const [isPreviewingRecon, setIsPreviewingRecon] = useState(false);
  const [editingRecon, setEditingRecon] = useState<ReconRow | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualSearch, setManualSearch] = useState('');
  const [manualResults, setManualResults] = useState<DebtorSearchResult[]>([]);
  const [isSearchingDebtors, setIsSearchingDebtors] = useState(false);
  const [manualSelectedDebtor, setManualSelectedDebtor] = useState<DebtorSearchResult | null>(null);
  const [manualAmount, setManualAmount] = useState('');
  const [manualNote, setManualNote] = useState('');
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<UploadFormData>({
    defaultValues: { clientId: '', fileId: '', reconciliationType: 'partial', receivedDate: '', receivedTime: '', notes: '' },
  });

  const editForm = useForm<EditReconForm>({
    defaultValues: { receivedDate: '', receivedTime: '', notes: '' },
  });

  const {
    data: reconData,
    refetch: refetchReconciliations,
  } = useCachedQuery<{ reconciliations: ReconRow[] }>('/api/reconciliations');
  const reconciliations = reconData?.reconciliations ?? [];

  const { data: filesData } = useCachedQuery<{ files: FileOption[] }>('/api/files');
  const files = filesData?.files ?? [];

  // Large reconciliations finish in the background (see POST /api/reconciliations) —
  // poll while any row is still status 'pending' so it updates on its own once done.
  useEffect(() => {
    if (!reconciliations.some((r) => r.status === 'pending')) return;
    const id = setInterval(refetchReconciliations, 4000);
    return () => clearInterval(id);
  }, [reconciliations, refetchReconciliations]);

  // Debounced debtor search for the Manual Entry modal — searches every client's
  // debtors (not scoped to "my queue"), reusing the same endpoint the admin screens
  // already search with.
  useEffect(() => {
    if (!manualModalOpen || manualSelectedDebtor || manualSearch.trim().length < 2) {
      setManualResults([]);
      return;
    }
    let cancelled = false;
    setIsSearchingDebtors(true);
    const id = setTimeout(() => {
      fetch(`/api/debtors?search=${encodeURIComponent(manualSearch.trim())}&pageSize=8`)
        .then((r) => r.json())
        .then((d) => { if (!cancelled) setManualResults(d.debtors ?? []); })
        .finally(() => { if (!cancelled) setIsSearchingDebtors(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(id); };
  }, [manualModalOpen, manualSearch, manualSelectedDebtor]);

  function openManualEntry() {
    setManualModalOpen(true);
    setManualSearch('');
    setManualResults([]);
    setManualSelectedDebtor(null);
    setManualAmount('');
    setManualNote('');
  }

  function closeManualEntry() {
    setManualModalOpen(false);
  }

  async function submitManualEntry() {
    if (!manualSelectedDebtor) return;
    const amount = Number(manualAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter an amount greater than zero');
      return;
    }
    setIsSubmittingManual(true);
    try {
      const res = await fetch('/api/reconciliations/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debtorId: manualSelectedDebtor.id, amount, note: manualNote || undefined }),
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || 'Could not record this payment');
        return;
      }
      toast.success(`${formatUGX(amount)} recorded for ${manualSelectedDebtor.name}`);
      closeManualEntry();
      refetchReconciliations();
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setIsSubmittingManual(false);
    }
  }

  const affectedDebtorsUrl = selectedReconId ? `/api/reconciliations/${selectedReconId}/affected-debtors` : null;
  const { data: affectedData } = useCachedQuery<{ affectedDebtors: AffectedDebtor[] }>(affectedDebtorsUrl);
  const affectedDebtors = affectedData?.affectedDebtors ?? [];

  const selectedRecon = reconciliations.find(r => r.id === selectedReconId);
  const selectedType = watch('reconciliationType');
  const watchedClientId = watch('clientId');

  const filtered = reconciliations.filter(r => {
    const matchSearch = (r.batchLabel ?? '').toLowerCase().includes(search.toLowerCase()) || r.client.toLowerCase().includes(search.toLowerCase());
    const matchClient = filterClient === 'All' || r.client === filterClient;
    const matchType = filterType === 'All' || r.type === filterType;
    return matchSearch && matchClient && matchType;
  });

  async function onReconFileSelected(file: globalThis.File | null) {
    setSelectedUploadFile(file);
    setReconPreview(null);
    setReconMapping(EMPTY_RECON_MAPPING);
    if (!file) return;

    setIsPreviewingRecon(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('reconciliationType', selectedType);
      const res = await fetch('/api/reconciliations/preview', { method: 'POST', body: form });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || 'Could not read this file');
        return;
      }
      setReconPreview(payload);
      setReconMapping(reconMappingFromSuggestion(payload.suggested));
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setIsPreviewingRecon(false);
    }
  }

  async function onUpload(data: UploadFormData) {
    if (!selectedUploadFile) {
      toast.error('Choose a reconciliation file to upload');
      return;
    }
    if (!reconMappingIsComplete(reconMapping)) {
      toast.error('Map Loan Ref or Phone, plus an amount column (or Name + Amount Owed for new accounts), before logging');
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
      form.append('mapping', JSON.stringify(buildReconMappingPayload(reconMapping)));

      const res = await fetch('/api/reconciliations', { method: 'POST', body: form });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || 'Could not log this reconciliation');
        return;
      }
      setUploadModalOpen(false);
      reset();
      setSelectedUploadFile(null);
      setReconPreview(null);
      setReconMapping(EMPTY_RECON_MAPPING);
      refetchReconciliations();
      setSelectedReconId(payload.reconciliation.id);
      toast.success(
        `${data.reconciliationType === 'full' ? 'Full' : 'Partial'} reconciliation logged — ${payload.reconciliation.recordCount} row(s) processing in the background, ready shortly`
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
        refetchReconciliations();
        return payload;
      })
      .finally(() => setProcessingId(null));

    toast.promise(request, {
      loading: 'Processing reconciliation…',
      success: 'Reconciliation processed — balances updated',
      error: (e) => e.message || 'Processing failed — check loan reference matching',
    });
  }

  function openEditRecon(r: ReconRow) {
    setEditingRecon(r);
    const receivedAt = new Date(r.receivedAt);
    const pad = (n: number) => String(n).padStart(2, '0');
    editForm.reset({
      receivedDate: `${receivedAt.getFullYear()}-${pad(receivedAt.getMonth() + 1)}-${pad(receivedAt.getDate())}`,
      receivedTime: `${pad(receivedAt.getHours())}:${pad(receivedAt.getMinutes())}`,
      notes: r.notes ?? '',
    });
  }

  async function onSubmitEditRecon(data: EditReconForm) {
    if (!editingRecon) return;
    setIsSavingEdit(true);
    try {
      const res = await fetch(`/api/reconciliations/${editingRecon.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receivedAt: `${data.receivedDate}T${data.receivedTime || '00:00'}`,
          notes: data.notes || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || 'Could not save changes');
        return;
      }
      toast.success('Reconciliation updated');
      setEditingRecon(null);
      refetchReconciliations();
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function deleteRecon(r: ReconRow) {
    const balanceNote = r.updatedCount > 0
      ? ` This reverses the balance/amount-paid changes it made to ${r.updatedCount} debtor(s).`
      : '';
    const newAccountsNote = r.newAccountsCount > 0
      ? ` The ${r.newAccountsCount} new account(s) it added stay — only their recorded starting payment is reversed.`
      : '';
    if (!window.confirm(`Permanently delete this reconciliation for ${r.client} (${r.batchLabel ?? 'no batch'})?${balanceNote}${newAccountsNote} There is no undo.`)) return;
    const res = await fetch(`/api/reconciliations/${r.id}`, { method: 'DELETE' });
    const payload = await res.json();
    if (!res.ok) {
      toast.error(payload.error || 'Could not delete this reconciliation');
      return;
    }
    toast.success('Reconciliation deleted');
    if (selectedReconId === r.id) setSelectedReconId(null);
    refetchReconciliations();
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
        <div className="hidden lg:flex items-center gap-2">
          <button
            onClick={() => openManualEntry()}
            disabled={offlineBlocked}
            title={offlineBlocked ? 'Offline — reconnect to record a payment' : undefined}
            className="flex items-center gap-1.5 px-4 py-2 bg-secondary text-secondary-foreground text-sm font-semibold rounded-lg hover:bg-secondary/80 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <UserCheck size={15} />
            Manual Entry
          </button>
          <button
            onClick={() => setUploadModalOpen(true)}
            disabled={offlineBlocked}
            title={offlineBlocked ? 'Offline — reconnect to log a reconciliation' : undefined}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Upload size={15} />
            Log New Reconciliation
          </button>
        </div>
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
                            disabled={processingId === recon.id || offlineBlocked}
                            className="p-1.5 rounded-md hover:bg-primary/10 text-primary transition-colors text-xs font-semibold disabled:opacity-50"
                            title={offlineBlocked ? 'Offline — reconnect to process' : 'Process this reconciliation now'}
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
                  disabled={offlineBlocked}
                  title={offlineBlocked ? 'Offline — reconnect to log a reconciliation' : undefined}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
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
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant={statusConfig[selectedRecon.status as keyof typeof statusConfig].variant}>
                      {statusConfig[selectedRecon.status as keyof typeof statusConfig].label}
                    </Badge>
                    <button
                      onClick={() => openEditRecon(selectedRecon)}
                      disabled={offlineBlocked}
                      title={offlineBlocked ? 'Offline — reconnect to edit' : 'Edit notes/date'}
                      className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground disabled:opacity-40"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => deleteRecon(selectedRecon)}
                      disabled={offlineBlocked}
                      title={offlineBlocked ? 'Offline — reconnect to delete' : 'Delete (reverses any balance changes it made)'}
                      className="p-1.5 rounded-md hover:bg-[var(--negative-bg)] hover:text-negative transition-colors text-muted-foreground disabled:opacity-40"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {selectedRecon.notes && (
                  <p className="text-xs text-muted-foreground -mt-2">{selectedRecon.notes}</p>
                )}

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
                    disabled={processingId === selectedRecon.id || offlineBlocked}
                    title={offlineBlocked ? 'Offline — reconnect to process' : undefined}
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

      <Fab onClick={() => setUploadModalOpen(true)} label="Log New Reconciliation" icon={Upload} disabled={offlineBlocked} />

      {/* Upload Modal */}
      <Modal
        open={uploadModalOpen}
        onClose={() => { setUploadModalOpen(false); reset(); setSelectedUploadFile(null); setReconPreview(null); setReconMapping(EMPTY_RECON_MAPPING); }}
        title="Log New Reconciliation"
        subtitle="Upload a reconciliation file received from a client and log the event"
        size="lg"
        footer={
          <>
            <button
              type="button"
              onClick={() => { setUploadModalOpen(false); reset(); setSelectedUploadFile(null); setReconPreview(null); setReconMapping(EMPTY_RECON_MAPPING); }}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              form="recon-upload-form"
              type="submit"
              disabled={isUploading || isPreviewingRecon || !reconPreview || !reconMappingIsComplete(reconMapping) || offlineBlocked}
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
          {/* Reconciliation type — picked before the file, since it decides whether we
              suggest "Amount Paid" or "Cumulative Paid" for the mapping's amount column */}
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

          {/* File upload */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">Reconciliation File <span className="text-negative">*</span></label>
            <p className="text-xs text-muted-foreground">
              Any column headers are fine — you&apos;ll confirm what maps to what below. Rows that don&apos;t
              match an existing debtor are added as new accounts if the row also has Name, Phone, and
              Amount Owed — so a client can send new accounts and reconciliation in one file.
            </p>
            <label className="block border-2 border-dashed border-border rounded-xl p-6 text-center hover:border-primary/50 transition-colors cursor-pointer bg-secondary/20">
              <input
                type="file"
                accept=".xlsx,.xlsb,.csv"
                className="sr-only"
                onChange={(e) => onReconFileSelected(e.target.files?.[0] ?? null)}
              />
              <Upload size={20} className="text-muted-foreground mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground">
                {selectedUploadFile ? selectedUploadFile.name : 'Click to browse for a reconciliation file'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Accepts .xlsx, .xlsb, or .csv up to 20MB</p>
            </label>
          </div>

          {isPreviewingRecon && (
            <p className="text-sm text-muted-foreground">Reading columns…</p>
          )}

          {reconPreview && (
            <div className="space-y-4 p-4 bg-secondary/30 rounded-xl border border-border">
              <div>
                <p className="text-sm font-semibold text-foreground">Map Columns</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {reconPreview.totalRows !== null
                    ? `${reconPreview.totalRows.toLocaleString()} row(s) detected.`
                    : 'Showing a sample — the full row count is confirmed during processing.'}{' '}
                  Matched what we could recognize — confirm or fix anything below before logging.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {([
                  ['loanRefCol', 'Loan Ref', false],
                  ['phoneCol', 'Phone', false],
                  ['amountCol', selectedType === 'full' ? 'Cumulative Paid' : 'Amount Paid', false],
                  ['amountOwedCol', 'Amount Owed (new accounts)', false],
                ] as const).map(([field, label, required]) => (
                  <div key={field} className="space-y-1">
                    <label className="text-xs font-semibold text-foreground uppercase tracking-wide">{label}</label>
                    <select
                      value={reconMapping[field]}
                      onChange={(e) => setReconMapping((m) => ({ ...m, [field]: e.target.value }))}
                      className="w-full px-3 py-2 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
                    >
                      <option value="">{required ? 'Select column…' : 'Not in this file'}</option>
                      {reconPreview.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground uppercase tracking-wide">Name (new accounts)</label>
                <p className="text-xs text-muted-foreground">Loan Ref or Phone is needed to match existing debtors; Name + Amount Owed together are what let an unmatched row become a new account instead of just a warning.</p>
                <select
                  value={reconMapping.nameCol}
                  onChange={(e) => setReconMapping((m) => ({ ...m, nameCol: e.target.value }))}
                  className="w-full px-3 py-2 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
                >
                  <option value="">Not in this file</option>
                  {reconPreview.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </select>
              </div>

              {reconPreview.sampleRows.length > 0 && (
                <div className="overflow-x-auto scrollbar-thin border border-border rounded-lg bg-card">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-secondary/40">
                        {reconPreview.headers.map((h, i) => (
                          <th key={i} className="px-2 py-1.5 text-left font-semibold text-muted-foreground whitespace-nowrap">{h || `Column ${i + 1}`}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {reconPreview.sampleRows.map((row, ri) => (
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

      {/* Edit reconciliation — metadata only. Type and every count/amount field are a
          record of what already happened to debtor balances, not editable inputs. */}
      <Modal
        open={!!editingRecon}
        onClose={() => setEditingRecon(null)}
        title="Edit Reconciliation"
        subtitle={editingRecon ? `${editingRecon.client} — ${editingRecon.batchLabel ?? 'no batch'}` : undefined}
        footer={
          <>
            <button
              onClick={() => setEditingRecon(null)}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              form="edit-recon-form"
              type="submit"
              disabled={isSavingEdit || offlineBlocked}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition-all disabled:opacity-60"
            >
              {isSavingEdit ? 'Saving…' : 'Save Changes'}
            </button>
          </>
        }
      >
        <form id="edit-recon-form" onSubmit={editForm.handleSubmit(onSubmitEditRecon)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">Date Received</label>
              <input
                type="date"
                className="w-full px-3 py-2.5 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
                {...editForm.register('receivedDate', { required: 'Enter the date received' })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">Time Received</label>
              <input
                type="time"
                className="w-full px-3 py-2.5 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
                {...editForm.register('receivedTime')}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">Notes</label>
            <textarea
              rows={3}
              placeholder="Any context about this reconciliation batch"
              className="w-full px-3 py-2 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 resize-none placeholder:text-muted-foreground"
              {...editForm.register('notes')}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Type, amounts, and match results can&apos;t be edited — they&apos;re a record of what actually happened to debtor balances, not editable inputs.
          </p>
        </form>
      </Modal>

      {/* Manual Entry — record one debtor's payment without uploading a file. Always a
          'partial' reconciliation under the hood (see api/reconciliations/manual). */}
      <Modal
        open={manualModalOpen}
        onClose={closeManualEntry}
        title="Manual Entry"
        subtitle="Record one debtor's payment directly — for a single payment between file uploads"
        footer={
          <>
            <button
              onClick={closeManualEntry}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={submitManualEntry}
              disabled={!manualSelectedDebtor || isSubmittingManual || offlineBlocked}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <UserCheck size={15} />
              {isSubmittingManual ? 'Recording…' : 'Record Payment'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {!manualSelectedDebtor ? (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">Debtor</label>
              <p className="text-xs text-muted-foreground">Search by name, loan reference, or phone</p>
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus
                  value={manualSearch}
                  onChange={(e) => setManualSearch(e.target.value)}
                  placeholder="e.g. Nakato Grace, or KCB-2024-0091"
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
                />
              </div>
              {isSearchingDebtors && <p className="text-xs text-muted-foreground">Searching…</p>}
              {!isSearchingDebtors && manualSearch.trim().length >= 2 && manualResults.length === 0 && (
                <p className="text-xs text-muted-foreground">No debtors match &quot;{manualSearch}&quot;.</p>
              )}
              {manualResults.length > 0 && (
                <div className="border border-border rounded-lg divide-y divide-border max-h-56 overflow-y-auto scrollbar-thin">
                  {manualResults.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => { setManualSelectedDebtor(d); setManualSearch(''); }}
                      className="w-full text-left px-3 py-2.5 hover:bg-secondary/50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">{d.name}</span>
                        <Badge variant={clientBadgeVariant(d.client)}>{d.client}</Badge>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <span className="text-xs font-mono-data text-muted-foreground">{d.loanRef}</span>
                        <span className="text-xs font-tabular text-muted-foreground">Balance: {formatUGX(d.balance)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2 p-3 bg-secondary/40 rounded-lg border border-border">
                <div>
                  <p className="text-sm font-semibold text-foreground">{manualSelectedDebtor.name}</p>
                  <p className="text-xs font-mono-data text-muted-foreground">{manualSelectedDebtor.loanRef}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Current balance: {formatUGX(manualSelectedDebtor.balance)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setManualSelectedDebtor(null)}
                  className="text-xs text-primary hover:underline shrink-0"
                >
                  Change
                </button>
              </div>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-foreground">Amount Collected (UGX) <span className="text-negative">*</span></label>
                <input
                  type="number"
                  autoFocus
                  value={manualAmount}
                  onChange={(e) => setManualAmount(e.target.value)}
                  placeholder="e.g. 150000"
                  className="w-full px-3 py-2.5 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 font-tabular"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-foreground">Notes</label>
                <textarea
                  rows={2}
                  value={manualNote}
                  onChange={(e) => setManualNote(e.target.value)}
                  placeholder="Optional — e.g. paid via mobile money, confirmed by phone"
                  className="w-full px-3 py-2 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 resize-none placeholder:text-muted-foreground"
                />
              </div>
              <p className="text-xs text-muted-foreground">Adds to whatever this debtor has already paid — the same as a partial reconciliation, just for one record.</p>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}