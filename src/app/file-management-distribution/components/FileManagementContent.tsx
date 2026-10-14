'use client';

import React, { useEffect, useState } from 'react';
import { FolderOpen, Upload, CheckCircle, Clock, Users, ChevronRight, FileText, Layers, UserPlus, Pencil, Trash2, Undo2, RefreshCcw, Download, Eraser, CalendarClock } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import Toggle from '@/components/ui/Toggle';
import EmptyState from '@/components/ui/EmptyState';
import Fab from '@/components/ui/Fab';
import ListToolbar from '@/components/ui/ListToolbar';
import ResponsiveList from '@/components/ui/ResponsiveList';
import InlineEditCell from '@/components/ui/InlineEditCell';
import ViewToggle from '@/components/ui/ViewToggle';

import { toast } from '@/lib/toast';
import { useForm } from 'react-hook-form';
import { useClients } from '@/lib/use-clients';
import { clientBadgeVariant } from '@/lib/client-badge';
import { useViewMode } from '@/lib/use-view-mode';
import { useCachedQuery } from '@/lib/use-cached-query';
import { useOfflineGuard } from '@/lib/use-offline-guard';
import { formatMoneyMB } from '@/lib/money';
import { DEPLOYMENT } from '@/config/deployment';
import FileCurrencySelect from '@/components/ui/FileCurrencySelect';
import { t , localeFor } from '@/i18n';
import { tx } from '@/i18n/tx';
import { BALANCE_BANDS, BAND_RANGE_LABELS } from '@/lib/distribution';

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

interface NewMonthPlan {
  clientName: string;
  cutoff: string;
  reconciliations: { id: string; batchLabel: string | null; receivedAt: string; busy: boolean }[];
  entryCount: number;
  paidEntryCount: number;
  paidDebtorCount: number;
  recoveredTotal: number;
  clearedDebtorCount: number;
  keptZeroBalanceCount: number;
  outstandingTotal: number;
  debtorCount: number;
  filesEmptied: { id: string; batchLabel: string }[];
}

/** Saves a server-built export to the user's downloads. Returns false (after toasting)
 *  when it fails, so a destructive step that depends on it can stop. */
async function downloadExport(url: string, fallbackName: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      toast.error(payload.error || t('Export failed — nothing was changed'));
      return false;
    }
    const blob = await res.blob();
    const match = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get('Content-Disposition') ?? '');
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = match ? decodeURIComponent(match[1]) : fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
    return true;
  } catch {
    toast.error('Could not reach the server — nothing was changed');
    return false;
  }
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

interface RemoveMatchRow {
  id: string;
  loanRef: string;
  name: string;
  balance: number;
  batchLabel: string;
  agentName: string | null;
}

interface RemovePreview {
  matched: RemoveMatchRow[];
  unmatchedRefs: string[];
}

interface DistributedSheetInfo {
  name: string;
  rowCount: number;
  matchedAgent: { id: string; name: string } | null;
}

type SheetAction = { action: 'assign'; agentId: string } | { action: 'unassigned' } | { action: 'skip' };

interface LastSync {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  error: string | null;
  newDebtorsCount: number;
  paymentsAppliedCount: number;
  paymentsSkippedCount: number;
  createdAt: string;
  completedAt: string | null;
}

function formatSyncTime(iso: string) {
  return new Date(iso).toLocaleString(localeFor('en-GB'), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

interface PaymentMappingState {
  loanRefCol: string;
  paidDateCol: string;
  paidAmountCol: string;
  companyCommissionCol: string;
}

const EMPTY_PAYMENT_MAPPING: PaymentMappingState = { loanRefCol: '', paidDateCol: '', paidAmountCol: '', companyCommissionCol: '' };

function paymentMappingFromSuggestion(s: { loanRefCol?: number; paidDateCol?: number; paidAmountCol?: number; companyCommissionCol?: number }): PaymentMappingState {
  const str = (n?: number) => (n === undefined ? '' : String(n));
  return { loanRefCol: str(s.loanRefCol), paidDateCol: str(s.paidDateCol), paidAmountCol: str(s.paidAmountCol), companyCommissionCol: str(s.companyCommissionCol) };
}

function paymentMappingIsComplete(m: PaymentMappingState): boolean {
  return m.loanRefCol !== '' && m.paidDateCol !== '' && m.paidAmountCol !== '';
}

function buildPaymentMappingPayload(m: PaymentMappingState) {
  const n = (v: string) => (v === '' ? undefined : Number(v));
  return { loanRefCol: n(m.loanRefCol), paidDateCol: n(m.paidDateCol), paidAmountCol: n(m.paidAmountCol), companyCommissionCol: n(m.companyCommissionCol) };
}

interface SyncSheetPreview {
  sheetName: string;
  headers: string[];
  sampleRows: string[][];
}

function encodeSheetAction(a: SheetAction | undefined): string {
  if (!a) return 'unassigned';
  if (a.action === 'assign') return `assign:${a.agentId}`;
  return a.action;
}

function decodeSheetAction(value: string): SheetAction {
  if (value === 'skip') return { action: 'skip' };
  if (value.startsWith('assign:')) return { action: 'assign', agentId: value.slice('assign:'.length) };
  return { action: 'unassigned' };
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
}

const EMPTY_MAPPING: MappingState = {
  nameMode: 'single', nameCol: '', firstNameCol: '', lastNameCol: '', middleNameCol: '',
  phone1Col: '', phone2Col: '', loanRefCol: '', amountOwedCol: '',
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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(localeFor('en-GB'));
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
  const [isExportingDistribution, setIsExportingDistribution] = useState(false);
  const [rebalanceAgentId, setRebalanceAgentId] = useState('');
  const [isRebalancing, setIsRebalancing] = useState(false);
  const [isReassigning, setIsReassigning] = useState(false);
  const [isMidMonth, setIsMidMonth] = useState(false);
  const [selectedUploadFile, setSelectedUploadFile] = useState<globalThis.File | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isDistributedImport, setIsDistributedImport] = useState(false);
  const [distributedSheets, setDistributedSheets] = useState<DistributedSheetInfo[]>([]);
  const [distributedAgents, setDistributedAgents] = useState<{ id: string; name: string }[]>([]);
  const [sheetActions, setSheetActions] = useState<Record<string, SheetAction>>({});

  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncUploadFile, setSyncUploadFile] = useState<globalThis.File | null>(null);
  const [isSyncPreviewing, setIsSyncPreviewing] = useState(false);
  const [syncPreview, setSyncPreview] = useState<{ callingList: SyncSheetPreview; payments: SyncSheetPreview } | null>(null);
  const [callingListMapping, setCallingListMapping] = useState<MappingState>(EMPTY_MAPPING);
  const [paymentMapping, setPaymentMapping] = useState<PaymentMappingState>(EMPTY_PAYMENT_MAPPING);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [mapping, setMapping] = useState<MappingState>(EMPTY_MAPPING);
  const [importCurrency, setImportCurrency] = useState('USD');
  const [syncCurrency, setSyncCurrency] = useState('USD');
  const [editingFile, setEditingFile] = useState<FileRow | null>(null);
  const [isSavingFile, setIsSavingFile] = useState(false);

  const [newMonthOpen, setNewMonthOpen] = useState(false);
  const [newMonthClientId, setNewMonthClientId] = useState('');
  const [newMonthPlan, setNewMonthPlan] = useState<NewMonthPlan | null>(null);
  const [isLoadingNewMonth, setIsLoadingNewMonth] = useState(false);
  const [newMonthConfirm, setNewMonthConfirm] = useState('');
  const [isStartingNewMonth, setIsStartingNewMonth] = useState(false);

  const [removeModalOpen, setRemoveModalOpen] = useState(false);
  const [removeClientId, setRemoveClientId] = useState('');
  const [removeUploadFile, setRemoveUploadFile] = useState<globalThis.File | null>(null);
  const [isRemovePreviewing, setIsRemovePreviewing] = useState(false);
  const [removePreview, setRemovePreview] = useState<RemovePreview | null>(null);
  const [removeSelectedIds, setRemoveSelectedIds] = useState<Set<string>>(new Set());
  const [isRemoving, setIsRemoving] = useState(false);
  const [isRemoveDragOver, setIsRemoveDragOver] = useState(false);

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
  const { data: distributionPayload, refetch: refetchDistribution } = useCachedQuery<{ distribution: DistributionRow[] }>(distributionUrl);
  const distributionData = distributionPayload?.distribution ?? [];

  const syncStatusUrl = distributionFileId ? `/api/files/${distributionFileId}/sync` : null;
  const { data: syncStatusPayload, refetch: refetchSyncStatus } = useCachedQuery<{ latest: LastSync | null }>(syncStatusUrl);
  const lastSync = syncStatusPayload?.latest ?? null;

  const filtered = files.filter(f => {
    const matchSearch = f.batchLabel.toLowerCase().includes(search.toLowerCase()) || f.client.toLowerCase().includes(search.toLowerCase());
    const matchClient = filterClient === 'All' || f.client === filterClient;
    const matchStatus = filterStatus === 'All' || f.status === filterStatus;
    return matchSearch && matchClient && matchStatus;
  });

  const selectedFile = files.find(f => f.id === distributionFileId);

  function resetImportModalState() {
    setSelectedUploadFile(null);
    setPreview(null);
    setMapping(EMPTY_MAPPING);
    setImportCurrency('USD');
    setIsMidMonth(false);
    setIsDistributedImport(false);
    setDistributedSheets([]);
    setDistributedAgents([]);
    setSheetActions({});
  }

  async function onFileSelected(file: globalThis.File | null) {
    setSelectedUploadFile(file);
    setPreview(null);
    setMapping(EMPTY_MAPPING);
    setImportCurrency('USD');
    setDistributedSheets([]);
    setDistributedAgents([]);
    setSheetActions({});
    if (!file) return;

    setIsPreviewing(true);
    try {
      if (isDistributedImport) {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/files/preview-distributed', { method: 'POST', body: form });
        const payload = await res.json();
        if (!res.ok) {
          toast.error(payload.error || t('Could not read this file'));
          return;
        }
        setPreview({ headers: payload.headers, sampleRows: payload.sampleRows, suggested: payload.suggested, totalRows: null });
        setMapping(mappingFromSuggestion(payload.suggested));
        setDistributedAgents(payload.agents);
        const sheets: DistributedSheetInfo[] = payload.sheets;
        setDistributedSheets(sheets);
        const initialActions: Record<string, SheetAction> = {};
        for (const s of sheets) {
          if (s.name === payload.suggestedMasterSheet) initialActions[s.name] = { action: 'skip' };
          else if (s.matchedAgent) initialActions[s.name] = { action: 'assign', agentId: s.matchedAgent.id };
          else initialActions[s.name] = { action: 'unassigned' };
        }
        setSheetActions(initialActions);
        return;
      }

      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/files/preview', { method: 'POST', body: form });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || t('Could not read this file'));
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

  function onDropUploadFile(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFileSelected(file);
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
    if (isDistributedImport && distributedSheets.every((s) => sheetActions[s.name]?.action === 'skip')) {
      toast.error('At least one sheet needs to actually import debtors — everything is set to skip');
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
      form.append('mapping', JSON.stringify({ ...buildMappingPayload(mapping), currency: importCurrency }));
      if (isDistributedImport) {
        form.append('isDistributedImport', 'true');
        form.append('sheetPlan', JSON.stringify(sheetActions));
      }

      const res = await fetch('/api/files', { method: 'POST', body: form });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || t('Import failed'));
        return;
      }
      setImportModalOpen(false);
      reset();
      resetImportModalState();
      refetchFiles();
      setDistributionFileId(payload.file.id);
      toast.success(
        isDistributedImport
          ? t('File "{0}" queued — importing with agent assignments preserved from each sheet', data.batchLabel)
          : t('File "{0}" queued — importing in the background, ready shortly', data.batchLabel)
      );
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
        toast.error(payload.error || t('Distribution failed'));
        return;
      }
      refetchFiles();
      refetchDistribution();
      toast.success(t('Distribution triggered — {0} debtors split across {1} agents', payload.assignedCount, payload.agentsUsed));
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setIsDistributing(false);
    }
  }

  async function exportDistribution(file: FileRow) {
    setIsExportingDistribution(true);
    try {
      const res = await fetch(`/api/files/${file.id}/distribution/export`);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t('Export failed'));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${file.client}-${file.batchLabel}-distribution.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Distribution exported — one sheet per agent, check your downloads');
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setIsExportingDistribution(false);
    }
  }

  function resetSyncModalState() {
    setSyncUploadFile(null);
    setSyncPreview(null);
    setCallingListMapping(EMPTY_MAPPING);
    setSyncCurrency('USD');
    setPaymentMapping(EMPTY_PAYMENT_MAPPING);
  }

  async function onSyncFileSelected(file: globalThis.File | null) {
    setSyncUploadFile(file);
    setSyncPreview(null);
    setCallingListMapping(EMPTY_MAPPING);
    setSyncCurrency('USD');
    setPaymentMapping(EMPTY_PAYMENT_MAPPING);
    if (!file || !selectedFile) return;

    setIsSyncPreviewing(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/files/${selectedFile.id}/sync/preview`, { method: 'POST', body: form });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || t('Could not read this file'));
        return;
      }
      setSyncPreview(payload);
      setCallingListMapping(mappingFromSuggestion(payload.callingList.suggested));
      setPaymentMapping(paymentMappingFromSuggestion(payload.payments.suggested));
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setIsSyncPreviewing(false);
    }
  }

  async function onSubmitSync() {
    if (!selectedFile || !syncUploadFile) {
      toast.error('Choose the daily file to sync');
      return;
    }
    if (!mappingIsComplete(callingListMapping)) {
      toast.error('Map Name, Phone, Loan Ref, and Amount Owed on the calling-list sheet first');
      return;
    }
    if (!paymentMappingIsComplete(paymentMapping)) {
      toast.error('Map Loan Ref, Payment Date, and Payment Amount on the payments sheet first');
      return;
    }
    setIsSyncing(true);
    try {
      const form = new FormData();
      form.append('file', syncUploadFile);
      form.append('callingListMapping', JSON.stringify({ ...buildMappingPayload(callingListMapping), currency: syncCurrency }));
      form.append('paymentMapping', JSON.stringify({ ...buildPaymentMappingPayload(paymentMapping), currency: syncCurrency }));

      const res = await fetch(`/api/files/${selectedFile.id}/sync`, { method: 'POST', body: form });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || t('Sync failed'));
        return;
      }
      setSyncModalOpen(false);
      resetSyncModalState();
      refetchSyncStatus();
      toast.success("Sync queued — new loans will be created and auto-distributed, this month's payments applied, shortly");
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setIsSyncing(false);
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
        toast.error(payload.error || t('Could not add agent to this file'));
        return;
      }
      setRebalanceAgentId('');
      refetchFiles();
      refetchDistribution();
      if (payload.reassignedCount > 0) {
        toast.success(payload.message);
      } else {
        // Genuinely zero debtors moved — worth flagging loudly rather than as a passable
        // info toast, since to the admin this looks identical to "the add worked" unless
        // they read the message closely.
        toast.error(payload.message);
      }
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setIsRebalancing(false);
    }
  }

  async function runReassign(fileId: string) {
    if (selectedAgentIds.length === 0) {
      toast.error('Select at least one agent to reassign to');
      return;
    }
    setIsReassigning(true);
    try {
      const res = await fetch(`/api/files/${fileId}/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentIds: selectedAgentIds }),
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || t('Reassignment failed'));
        return;
      }
      refetchFiles();
      refetchDistribution();
      toast.success(t('{0} debtor(s) moved, {1} left with their current agent', payload.movedCount, payload.keptCount));
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setIsReassigning(false);
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
        toast.error(payload.error || t('Could not update file'));
        return;
      }
      toast.success(t('"{0}" updated', data.batchLabel));
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
    if (nextRecalled && !window.confirm(t('Recall "{0}"? Agents will stop seeing its debtors in their active queue.', file.batchLabel))) return;
    const res = await fetch(`/api/files/${file.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isRecalled: nextRecalled }),
    });
    const payload = await res.json();
    if (!res.ok) {
      toast.error(payload.error || t('Could not update file'));
      return;
    }
    toast.success(nextRecalled ? t('"{0}" recalled', file.batchLabel) : t('"{0}" reactivated', file.batchLabel));
    refetchFiles();
  }

  async function deleteFile(file: FileRow) {
    if (!window.confirm(t('Permanently delete "{0}"? This deletes all {1} debtor(s) AND every call logged against them — there is no undo.', file.batchLabel, file.debtorCount))) return;
    const res = await fetch(`/api/files/${file.id}`, { method: 'DELETE' });
    const payload = await res.json();
    if (!res.ok) {
      toast.error(payload.error || t('Could not delete file'));
      return;
    }
    toast.success(t('"{0}" deleted', file.batchLabel));
    if (distributionFileId === file.id) setDistributionFileId(null);
    refetchFiles();
  }

  async function clearDispositions(file: FileRow) {
    const res = await fetch(`/api/files/${file.id}/clear-dispositions`);
    const counts = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(counts.error || t('Could not check this file\'s dispositions'));
      return;
    }
    if (counts.callCount === 0) {
      toast.info(t('"{0}" has no dispositions to clear', file.batchLabel));
      return;
    }
    if (!window.confirm(t('Clear ALL dispositions in "{0}"? This permanently deletes {1} logged call(s) across {2} debtor(s) — notes, promises and corrections included — so every debtor shows as not yet called. Balances and payments are not touched. A copy is downloaded first. There is no undo.', file.batchLabel, counts.callCount.toLocaleString(), counts.debtorCount.toLocaleString()))) return;
    if (!(await downloadExport(`/api/files/${file.id}/clear-dispositions/export`, `${file.client}-${file.batchLabel}-dispositions.xlsx`))) return;
    const clearRes = await fetch(`/api/files/${file.id}/clear-dispositions`, { method: 'POST' });
    const payload = await clearRes.json().catch(() => ({}));
    if (!clearRes.ok) {
      toast.error(payload.error || t('Could not clear dispositions'));
      return;
    }
    toast.success(t('Cleared {0} disposition(s) in "{1}" — export saved to your downloads', payload.clearedCount.toLocaleString(), file.batchLabel));
    refetchFiles();
  }

  function resetNewMonthState() {
    setNewMonthClientId('');
    setNewMonthPlan(null);
    setNewMonthConfirm('');
  }

  async function onNewMonthClientChange(clientId: string) {
    setNewMonthClientId(clientId);
    setNewMonthPlan(null);
    setNewMonthConfirm('');
    if (!clientId) return;
    setIsLoadingNewMonth(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/new-month`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('Could not load the new-month preview'));
        return;
      }
      setNewMonthPlan(payload.plan);
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setIsLoadingNewMonth(false);
    }
  }

  async function onStartNewMonth() {
    if (!newMonthPlan || !newMonthClientId) return;
    setIsStartingNewMonth(true);
    try {
      // The export is the safety net — if it can't be saved, nothing gets deleted.
      if (!(await downloadExport(`/api/clients/${newMonthClientId}/new-month/export`, `${newMonthPlan.clientName}-before-new-month.xlsx`))) return;
      const res = await fetch(`/api/clients/${newMonthClientId}/new-month`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmName: newMonthConfirm }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('Could not start the new month'));
        return;
      }
      const r = payload.result;
      toast.success(t('New month started for {0}: {1} reconciliation(s) cleared, {2} zero-balance debtor(s) removed. Export saved to your downloads.', newMonthPlan.clientName, r.reconciliationsCleared, r.debtorsRemoved));
      if (r.filesEmptied.length > 0) {
        toast.info(t('Now empty and safe to delete: {0}', r.filesEmptied.map((f: { batchLabel: string }) => f.batchLabel).join(', ')));
      }
      setNewMonthOpen(false);
      resetNewMonthState();
      refetchFiles();
    } finally {
      setIsStartingNewMonth(false);
    }
  }

  function resetRemoveModalState() {
    setRemoveClientId('');
    setRemoveUploadFile(null);
    setRemovePreview(null);
    setRemoveSelectedIds(new Set());
  }

  async function previewRemove(clientId: string, file: globalThis.File) {
    setIsRemovePreviewing(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('clientId', clientId);
      const res = await fetch('/api/debtors/bulk-remove/preview', { method: 'POST', body: form });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || t('Could not read this file'));
        return;
      }
      setRemovePreview(payload);
      setRemoveSelectedIds(new Set(payload.matched.map((m: RemoveMatchRow) => m.id)));
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setIsRemovePreviewing(false);
    }
  }

  function onRemoveClientChange(next: string) {
    setRemoveClientId(next);
    setRemovePreview(null);
    setRemoveSelectedIds(new Set());
    if (removeUploadFile && next) previewRemove(next, removeUploadFile);
  }

  async function onRemoveFileSelected(file: globalThis.File | null) {
    setRemoveUploadFile(file);
    setRemovePreview(null);
    setRemoveSelectedIds(new Set());
    if (!file) return;
    if (!removeClientId) {
      toast.error('Select the client first');
      return;
    }
    await previewRemove(removeClientId, file);
  }

  function onDropRemoveUploadFile(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setIsRemoveDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onRemoveFileSelected(file);
  }

  function toggleRemoveSelected(id: string) {
    setRemoveSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function onConfirmRemove() {
    if (removeSelectedIds.size === 0) return;
    if (!window.confirm(t('Permanently delete {0} account(s) and every call logged against them? There is no undo.', removeSelectedIds.size))) return;

    setIsRemoving(true);
    try {
      const res = await fetch('/api/debtors/bulk-remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debtorIds: [...removeSelectedIds] }),
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || t('Could not remove these accounts'));
        return;
      }
      toast.success(t('{0} account(s) removed', payload.deletedCount));
      setRemoveModalOpen(false);
      resetRemoveModalState();
      refetchFiles();
      refetchDistribution();
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setIsRemoving(false);
    }
  }

  async function retryImport(file: FileRow) {
    const res = await fetch(`/api/files/${file.id}/import`, { method: 'POST' });
    const payload = await res.json();
    if (!res.ok) {
      toast.error(payload.error || t('Could not retry this import'));
      return;
    }
    toast.info(t('Retrying import for "{0}"', file.batchLabel));
    refetchFiles();
  }

  return (
    <div className="p-6 xl:p-8 2xl:p-10 max-w-screen-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-page-title text-foreground">{t('File Management & Distribution')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('Manage client file batches and agent allocation by balance range')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setNewMonthOpen(true)}
            disabled={offlineBlocked}
            title={offlineBlocked ? t('Offline — reconnect to start a new month') : t('Clear last month\'s reconciliations and zero-balance debtors for one client')}
            className="flex items-center gap-1.5 px-4 py-2 bg-secondary text-foreground text-sm font-semibold rounded-lg hover:bg-secondary/80 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <CalendarClock size={15} />
            {t('Start New Month')}
          </button>
          <button
            onClick={() => setRemoveModalOpen(true)}
            disabled={offlineBlocked}
            title={offlineBlocked ? t('Offline — reconnect to remove accounts') : t('Remove accounts a client has insourced, across any of their file batches')}
            className="flex items-center gap-1.5 px-4 py-2 bg-secondary text-foreground text-sm font-semibold rounded-lg hover:bg-secondary/80 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Trash2 size={15} />
            {t('Remove Accounts')}
          </button>
          <button
            onClick={() => setImportModalOpen(true)}
            disabled={offlineBlocked}
            title={offlineBlocked ? t('Offline — reconnect to import') : undefined}
            className="hidden lg:flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Upload size={15} />
            {t('Import New File')}
          </button>
        </div>
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
              <p className="text-xs text-muted-foreground font-medium">{t(stat.label)}</p>
              <p className="font-tabular font-bold text-lg text-foreground">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 2xl:grid-cols-3 gap-6">
        {/* File list */}
        <div className="xl:col-span-2 2xl:col-span-2 bg-card rounded-xl shadow-card border border-border">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-section-header text-foreground">{t('Client File Batches')}</h2>
            <ListToolbar
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder={t('Search files…')}
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
                    <th key={`fth-${t(col)}`} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      {t(col)}
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
                              if (!res.ok) { toast.error(payload.error || t('Could not update batch label')); return; }
                              refetchFiles();
                            }}
                          />
                          {file.isMidMonthTopup && (
                            <span className="text-xs text-positive font-semibold">{t('Mid-month top-up')}</span>
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
                        <span className="text-xs text-warning ml-1">{t('({0} unassigned)', file.debtorCount - file.assignedCount)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-tabular text-sm text-foreground">{formatMoneyMB(file.totalBalance)}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-tabular text-sm text-foreground">{file.agentsAllocated}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge variant={sc.variant}>{t(sc.label)}</Badge>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          className="p-1.5 rounded-md hover:bg-primary/10 text-primary transition-colors"
                          title={t('View distribution')}
                          onClick={(e) => { e.stopPropagation(); setDistributionFileId(file.id); }}
                        >
                          <ChevronRight size={15} />
                        </button>
                        {file.importStatus === 'failed' && (
                          <button
                            className="p-1.5 rounded-md hover:bg-primary/10 text-primary transition-colors disabled:opacity-40"
                            title={offlineBlocked ? t('Offline — reconnect to retry') : t('Retry import')}
                            disabled={offlineBlocked}
                            onClick={(e) => { e.stopPropagation(); retryImport(file); }}
                          >
                            <RefreshCcw size={14} />
                          </button>
                        )}
                        <button
                          className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground disabled:opacity-40"
                          title={offlineBlocked ? t('Offline — reconnect to edit') : t('Edit')}
                          disabled={offlineBlocked}
                          onClick={(e) => { e.stopPropagation(); openEditFile(file); }}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground disabled:opacity-40"
                          title={offlineBlocked ? t('Offline — reconnect') : (file.status === 'recalled' ? t('Reactivate') : t('Recall'))}
                          disabled={offlineBlocked}
                          onClick={(e) => { e.stopPropagation(); toggleRecall(file); }}
                        >
                          <Undo2 size={14} />
                        </button>
                        <button
                          className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground disabled:opacity-40"
                          title={offlineBlocked ? t('Offline — reconnect') : t('Clear all dispositions')}
                          disabled={offlineBlocked}
                          onClick={(e) => { e.stopPropagation(); clearDispositions(file); }}
                        >
                          <Eraser size={14} />
                        </button>
                        <button
                          className="p-1.5 rounded-md hover:bg-[var(--negative-bg)] hover:text-negative transition-colors text-muted-foreground disabled:opacity-40"
                          title={offlineBlocked ? t('Offline — reconnect to delete') : t('Delete')}
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
                          {file.isMidMonthTopup && <span className="text-xs text-positive font-semibold">{t('Mid-month top-up')}</span>}
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-muted-foreground shrink-0" />
                    </div>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <Badge variant={clientBadgeVariant(file.client)}>{file.client}</Badge>
                      <Badge variant={sc.variant}>{t(sc.label)}</Badge>
                      <span className="text-xs text-muted-foreground">{formatDate(file.receivedDate)}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                      <div>
                        <span className="text-muted-foreground block">{t('Debtors')}</span>
                        <span className="font-tabular font-semibold text-foreground">{file.debtorCount.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">{t('Balance')}</span>
                        <span className="font-tabular font-semibold text-foreground">{formatMoneyMB(file.totalBalance)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">{t('Agents')}</span>
                        <span className="font-tabular font-semibold text-foreground">{file.agentsAllocated}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 mt-3 pt-3 border-t border-border/60" onClick={(e) => e.stopPropagation()}>
                      {file.importStatus === 'failed' && (
                        <button className="p-1.5 rounded-md hover:bg-primary/10 text-primary transition-colors disabled:opacity-40" title={offlineBlocked ? t('Offline — reconnect to retry') : t('Retry import')} disabled={offlineBlocked} onClick={() => retryImport(file)}>
                          <RefreshCcw size={14} />
                        </button>
                      )}
                      <button className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground disabled:opacity-40" title={offlineBlocked ? t('Offline — reconnect to edit') : t('Edit')} disabled={offlineBlocked} onClick={() => openEditFile(file)}>
                        <Pencil size={14} />
                      </button>
                      <button className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground disabled:opacity-40" title={offlineBlocked ? t('Offline — reconnect') : (file.status === 'recalled' ? t('Reactivate') : t('Recall'))} disabled={offlineBlocked} onClick={() => toggleRecall(file)}>
                        <Undo2 size={14} />
                      </button>
                      <button className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground disabled:opacity-40" title={offlineBlocked ? t('Offline — reconnect') : t('Clear all dispositions')} disabled={offlineBlocked} onClick={() => clearDispositions(file)}>
                        <Eraser size={14} />
                      </button>
                      <button className="p-1.5 rounded-md hover:bg-[var(--negative-bg)] hover:text-negative transition-colors text-muted-foreground disabled:opacity-40" title={offlineBlocked ? t('Offline — reconnect to delete') : t('Delete')} disabled={offlineBlocked} onClick={() => deleteFile(file)}>
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
              title={t('No files found')}
              description={t('No client file batches match your current filters. Import a new file to get started.')}
              action={
                <button
                  onClick={() => setImportModalOpen(true)}
                  disabled={offlineBlocked}
                  title={offlineBlocked ? t('Offline — reconnect to import') : undefined}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Upload size={14} />
                  {t('Import New File')}
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
                    <h3 className="text-section-header text-foreground">{t('Agent Distribution')}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5 font-mono-data">{selectedFile.batchLabel}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={fileStatusBadge(selectedFile).variant}>
                      {t(fileStatusBadge(selectedFile).label)}
                    </Badge>
                    {distributionData.length > 0 && (
                      <button
                        onClick={() => exportDistribution(selectedFile)}
                        disabled={isExportingDistribution || offlineBlocked}
                        title={offlineBlocked ? t('Offline — reconnect to export') : t('Export — one sheet per agent')}
                        className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                      >
                        <Download size={14} className={isExportingDistribution ? 'animate-pulse' : ''} />
                      </button>
                    )}
                    <button
                      onClick={() => setSyncModalOpen(true)}
                      disabled={offlineBlocked}
                      title={offlineBlocked ? t('Offline — reconnect to sync') : t('Sync Update — pick up new loans and this month\'s payments from a client\'s daily file')}
                      className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                    >
                      <RefreshCcw size={14} />
                    </button>
                  </div>
                </div>

                {lastSync && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {t('Last sync {0}:', formatSyncTime(lastSync.completedAt ?? lastSync.createdAt))}{' '}
                    {lastSync.status === 'failed'
                      ? <span className="text-negative">{t('failed — {0}', lastSync.error)}</span>
                      : lastSync.status === 'complete'
                        ? (lastSync.paymentsSkippedCount > 0
                          ? t('{0} new debtor(s), {1} payment(s) applied, {2} already recorded', lastSync.newDebtorsCount, lastSync.paymentsAppliedCount, lastSync.paymentsSkippedCount)
                          : t('{0} new debtor(s), {1} payment(s) applied', lastSync.newDebtorsCount, lastSync.paymentsAppliedCount))
                        : t('in progress…')}
                  </p>
                )}

                {/* Balance band legend */}
                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  {[
                    { label: BALANCE_BANDS[0].label, className: 'balance-band-easy text-xs px-2 py-1 rounded-md font-medium' },
                    { label: BALANCE_BANDS[1].label, className: 'balance-band-medium text-xs px-2 py-1 rounded-md font-medium' },
                    { label: BALANCE_BANDS[2].label, className: 'balance-band-hard text-xs px-2 py-1 rounded-md font-medium' },
                    { label: BALANCE_BANDS[3].label, className: 'bg-[#FEF2F2] text-negative text-xs px-2 py-1 rounded-md font-medium' },
                  ].map((band) => (
                    <span key={`band-${band.label}`} className={band.className}>{band.label}</span>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-secondary/30">
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('Agent')}</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-muted-foreground">{BAND_RANGE_LABELS[0]}</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-muted-foreground">{BAND_RANGE_LABELS[1]}</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-muted-foreground">{BAND_RANGE_LABELS[2]}</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-muted-foreground">{BAND_RANGE_LABELS[3]}</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-muted-foreground">{t('Total')}</th>
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
                      <td className="px-3 py-2 text-xs font-bold text-foreground">{t('Totals')}</td>
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
                      <p className="text-xs font-semibold text-foreground">{t('Agents for this file')}</p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setSelectedAgentIds(agents.map((a) => a.id))}
                          className="text-xs text-primary hover:underline"
                        >
                          {t('All')}
                        </button>
                        <button
                          onClick={() => setSelectedAgentIds([])}
                          className="text-xs text-muted-foreground hover:underline"
                        >
                          {t('None')}
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
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-info bg-[var(--info-bg)] px-1.5 py-0.5 rounded-full">{t('Admin')}</span>
                          )}
                        </label>
                      ))}
                      {agents.length === 0 && (
                        <p className="px-3 py-3 text-xs text-muted-foreground text-center">{t('No active agents yet — add one under Admin → Users.')}</p>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{t('{0} of {1} agents selected', selectedAgentIds.length, agents.length)}</p>
                  </div>
                  <button
                    onClick={() => runDistribution(selectedFile.id)}
                    disabled={isDistributing || selectedAgentIds.length === 0 || offlineBlocked}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60"
                  >
                    <Users size={15} />
                    {isDistributing ? t('Distributing…') : t('Run Auto-Distribution')}
                  </button>
                  <p className="text-xs text-muted-foreground text-center">{t('Splits debtors by balance range across the agents selected above')}</p>
                </div>
              )}

              {selectedFile.status === 'active' && (
                <div className="p-4 border-t border-border space-y-2">
                  <p className="text-xs font-semibold text-foreground">{t('Add an agent to this file')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('For an agent joining after distribution already ran. Pulls debtors from the current roster — never-called accounts first, then called-but-uncollected — leaving accounts that already have a payment untouched, and keeps the roster balanced as it goes.')}
                  </p>
                  <div className="flex items-center gap-2">
                    <select
                      value={rebalanceAgentId}
                      onChange={(e) => setRebalanceAgentId(e.target.value)}
                      className="flex-1 text-sm bg-input border border-border rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-ring/50"
                    >
                      <option value="">{t('Select agent…')}</option>
                      {agents
                        .filter((a) => !distributionData.some((row) => row.agentId === a.id))
                        .map((a) => <option key={a.id} value={a.id}>{a.name}{a.role === 'admin' ? (' ' + t('(Admin)')) : ''}</option>)}
                    </select>
                    <button
                      onClick={() => runRebalance(selectedFile.id)}
                      disabled={!rebalanceAgentId || isRebalancing || offlineBlocked}
                      className="flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60 whitespace-nowrap"
                    >
                      <UserPlus size={15} />
                      {isRebalancing ? t('Adding…') : t('Add')}
                    </button>
                  </div>
                </div>
              )}

              {selectedFile.status === 'recalled' && (
                <div className="p-4 border-t border-border space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-foreground">{t('Reassign this file')}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t('Pick the new roster of agents for this file. Anyone staying on the list keeps what they already have; everyone else\'s debtors are split across the new roster by balance range, same as a fresh distribution.')}
                    </p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs font-semibold text-foreground">{t('New agent roster')}</p>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setSelectedAgentIds(agents.map((a) => a.id))} className="text-xs text-primary hover:underline">{t('All')}</button>
                        <button onClick={() => setSelectedAgentIds([])} className="text-xs text-muted-foreground hover:underline">{t('None')}</button>
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
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-info bg-[var(--info-bg)] px-1.5 py-0.5 rounded-full">{t('Admin')}</span>
                          )}
                        </label>
                      ))}
                      {agents.length === 0 && (
                        <p className="px-3 py-3 text-xs text-muted-foreground text-center">{t('No active agents yet — add one under Admin → Users.')}</p>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{t('{0} of {1} agents selected', selectedAgentIds.length, agents.length)}</p>
                  </div>
                  <button
                    onClick={() => runReassign(selectedFile.id)}
                    disabled={isReassigning || selectedAgentIds.length === 0 || offlineBlocked}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60"
                  >
                    <Users size={15} />
                    {isReassigning ? t('Reassigning…') : t('Reassign File')}
                  </button>
                  <p className="text-xs text-muted-foreground text-center">{t('Reactivate the file (Recall button) once you\'re done to let agents see it again')}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-card rounded-xl shadow-card border border-border p-8 text-center">
              <Layers size={32} className="text-muted mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">{t('Select a file')}</p>
              <p className="text-xs text-muted-foreground mt-1">{t('Click any file row to view its agent distribution breakdown')}</p>
            </div>
          )}
        </div>
      </div>

      <Fab onClick={() => setImportModalOpen(true)} label={t('Import New File')} icon={Upload} disabled={offlineBlocked} />

      {/* Import Modal */}
      <Modal
        open={importModalOpen}
        onClose={() => { setImportModalOpen(false); reset(); resetImportModalState(); }}
        title={t('Import New Client File')}
        subtitle={t('Upload an Excel file and configure how debtors are split across agents')}
        size="lg"
        footer={
          <>
            <button
              type="button"
              onClick={() => { setImportModalOpen(false); reset(); resetImportModalState(); }}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
            >
              {t('Cancel')}
            </button>
            <button
              form="import-form"
              type="submit"
              disabled={
                isImporting || isPreviewing || !preview || !mappingIsComplete(mapping) || offlineBlocked ||
                (isDistributedImport && distributedSheets.every((s) => sheetActions[s.name]?.action === 'skip'))
              }
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100"
            >
              {isImporting ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>{t('Importing…')}</span>
                </>
              ) : (
                <>
                  <Upload size={15} />
                  <span>{t('Import & Queue Distribution')}</span>
                </>
              )}
            </button>
          </>
        }
      >
        <form id="import-form" onSubmit={handleSubmit(onImport)} className="space-y-5">
          {/* Already-distributed toggle */}
          <div className="flex items-start gap-3 p-4 bg-secondary/40 rounded-lg border border-border">
            <Toggle
              checked={isDistributedImport}
              onChange={(checked) => {
                setIsDistributedImport(checked);
                if (selectedUploadFile) onFileSelected(selectedUploadFile);
              }}
              size="md"
            />
            <div>
              <p className="text-sm font-medium text-foreground">{t('Already Distributed by Agent')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t('Enable if this file was split by agent outside the app (one sheet per agent, e.g. "DESMOND", "JONATHAN"). Skips Run Auto-Distribution — each sheet\'s rows are assigned straight to that agent, and any sheet name that doesn\'t match a real user gets flagged so you can fix it before importing.')}
              </p>
            </div>
          </div>

          {/* File upload zone */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              {t('Excel File')}{' '}<span className="text-negative">*</span>
            </label>
            <p className="text-xs text-muted-foreground">{t('Upload the file received from the client — any column headers are fine, you\'ll confirm what maps to what below.')}</p>
            <label
              className={`block border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${isDragOver ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50 bg-secondary/20'}`}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={onDropUploadFile}
            >
              <input
                type="file"
                accept=".xlsx,.xlsb,.csv"
                className="sr-only"
                onChange={(e) => onFileSelected(e.target.files?.[0] ?? null)}
              />
              <Upload size={24} className="text-muted-foreground mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground">
                {selectedUploadFile ? selectedUploadFile.name : (isDragOver ? t('Drop the file here') : t('Click to browse, or drag a file here'))}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{t('Accepts .xlsx, .xlsb, or .csv files up to 50MB')}</p>
              <span className="inline-block mt-3 px-3 py-1.5 text-xs font-semibold text-primary border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors">
                {t('Browse Files')}
              </span>
            </label>
          </div>

          {isPreviewing && (
            <p className="text-sm text-muted-foreground">{t('Reading columns…')}</p>
          )}

          {preview && (
            <div className="space-y-4 p-4 bg-secondary/30 rounded-xl border border-border">
              <div>
                <p className="text-sm font-semibold text-foreground">{t('Map Columns')}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {preview.totalRows !== null
                    ? t('{0} row(s) detected.', preview.totalRows.toLocaleString())
                    : t('Showing a sample — the full row count is confirmed during import.')}{' '}{t('Matched what we could recognize — confirm or fix anything below before importing.')}
                </p>
              </div>

              <FileCurrencySelect value={importCurrency} onChange={setImportCurrency} />

              {/* Name */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground uppercase tracking-wide">{t('Name')}{' '}<span className="text-negative">*</span></label>
                  <div className="flex items-center gap-1 text-xs">
                    <button type="button" onClick={() => setMapping((m) => ({ ...m, nameMode: 'single' }))} className={`px-2 py-0.5 rounded-full ${mapping.nameMode === 'single' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>{t('One column')}</button>
                    <button type="button" onClick={() => setMapping((m) => ({ ...m, nameMode: 'split' }))} className={`px-2 py-0.5 rounded-full ${mapping.nameMode === 'split' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>{t('First / Last')}</button>
                  </div>
                </div>
                {mapping.nameMode === 'single' ? (
                  <select
                    value={mapping.nameCol}
                    onChange={(e) => setMapping((m) => ({ ...m, nameCol: e.target.value }))}
                    className="w-full px-3 py-2 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
                  >
                    <option value="">{t('Select column…')}</option>
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
                        <option value="">{t(['First…', 'Last…', 'Middle (optional)…'][idx])}</option>
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
                    <label className="text-xs font-semibold text-foreground uppercase tracking-wide">{t(label)}{required && <span className="text-negative"> *</span>}</label>
                    <select
                      value={mapping[field]}
                      onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}
                      className="w-full px-3 py-2 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
                    >
                      <option value="">{required ? t('Select column…') : t('Not in this file')}</option>
                      {preview.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">
                {t('Every other column in the file (arrears days, last payment, installment, current/principal balance, payroll status, etc.) is kept automatically and shown to agents as Additional Info on the debtor card — no separate mapping needed.')}
              </p>

              {preview.sampleRows.length > 0 && (
                <div className="overflow-x-auto scrollbar-thin border border-border rounded-lg bg-card">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-secondary/40">
                        {preview.headers.map((h, i) => (
                          <th key={i} className="px-2 py-1.5 text-left font-semibold text-muted-foreground whitespace-nowrap">{h || t('Column {0}', i + 1)}</th>
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

          {isDistributedImport && distributedSheets.length > 0 && (() => {
            const unresolvedCount = distributedSheets.filter(
              (s) => sheetActions[s.name]?.action === 'unassigned' && !s.matchedAgent
            ).length;
            return (
              <div className="space-y-3 p-4 bg-secondary/30 rounded-xl border border-border">
                <div>
                  <p className="text-sm font-semibold text-foreground">{t('Sheet Distribution')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {unresolvedCount > 0
                      ? (unresolvedCount === 1
                        ? t('{0} sheet name didn\'t match a user — pick the right agent below, or leave unassigned/skip.', unresolvedCount)
                        : t('{0} sheet names didn\'t match a user — pick the right agent below, or leave unassigned/skip.', unresolvedCount))
                      : t('Every sheet name matched a real user. Double-check the reference sheet is set to Skip before importing.')}
                  </p>
                </div>
                <div className="overflow-x-auto scrollbar-thin border border-border rounded-lg bg-card">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-secondary/40">
                        <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground whitespace-nowrap">{t('Sheet')}</th>
                        <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground whitespace-nowrap">{t('Rows')}</th>
                        <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground whitespace-nowrap">{t('Assignment')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {distributedSheets.map((s) => {
                        const current = sheetActions[s.name];
                        const unmatched = !s.matchedAgent && current?.action === 'unassigned';
                        return (
                          <tr key={s.name} className={`border-b border-border/60 last:border-0 ${unmatched ? 'bg-[var(--negative-bg)]' : ''}`}>
                            <td className="px-2 py-1.5 whitespace-nowrap font-medium text-foreground">
                              {s.name}
                              {unmatched && <span className="ml-1.5 text-negative font-semibold">{t('Not recognized')}</span>}
                            </td>
                            <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">{s.rowCount.toLocaleString()}</td>
                            <td className="px-2 py-1.5 whitespace-nowrap">
                              <select
                                value={encodeSheetAction(current)}
                                onChange={(e) => setSheetActions((prev) => ({ ...prev, [s.name]: decodeSheetAction(e.target.value) }))}
                                className="w-full px-2 py-1.5 text-xs bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
                              >
                                <option value="skip">{t('Skip — reference/master sheet')}</option>
                                <option value="unassigned">{t('Leave unassigned')}</option>
                                {distributedAgents.map((a) => (
                                  <option key={a.id} value={`assign:${a.id}`}>{t('Assign to {0}', a.name)}</option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Client */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">
                {t('Client')}{' '}<span className="text-negative">*</span>
              </label>
              <select
                className={`w-full px-3 py-2.5 text-sm bg-input border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 ${errors.clientId ? 'border-negative' : 'border-border'}`}
                {...register('clientId', { required: t('Select a client') })}
              >
                <option value="">{t('Select client…')}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {errors.clientId && <p className="text-xs text-negative">{t(errors.clientId.message)}</p>}
            </div>

            {/* Received date */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">
                {t('Date Received')}{' '}<span className="text-negative">*</span>
              </label>
              <input
                type="date"
                className={`w-full px-3 py-2.5 text-sm bg-input border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 ${errors.receivedDate ? 'border-negative' : 'border-border'}`}
                {...register('receivedDate', { required: t('Enter the date the file was received') })}
              />
              {errors.receivedDate && <p className="text-xs text-negative">{t(errors.receivedDate.message)}</p>}
            </div>
          </div>

          {/* Batch label */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              {t('Batch Label')}{' '}<span className="text-negative">*</span>
            </label>
            <p className="text-xs text-muted-foreground">{t('A unique name for this batch, {0}', t(DEPLOYMENT.batchPlaceholder))}</p>
            <input
              type="text"
              placeholder={t(DEPLOYMENT.batchPlaceholder)}
              className={`w-full px-3 py-2.5 text-sm bg-input border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 font-mono-data ${errors.batchLabel ? 'border-negative' : 'border-border'}`}
              {...register('batchLabel', { required: t('Enter a batch label') })}
            />
            {errors.batchLabel && <p className="text-xs text-negative">{t(errors.batchLabel.message)}</p>}
          </div>

          {/* Mid-month top-up toggle */}
          <div className="flex items-start gap-3 p-4 bg-secondary/40 rounded-lg border border-border">
            <Toggle
              checked={isMidMonth}
              onChange={setIsMidMonth}
              size="md"
            />
            <div>
              <p className="text-sm font-medium text-foreground">{t('Mid-Month Top-Up')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t('Enable if this is a supplemental batch added mid-month. New debtors will be merged into the existing active file and distributed using the same balance-range split — no manual re-splitting required.')}
              </p>
            </div>
          </div>

          {/* Distribution method */}
          {isDistributedImport ? (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">{t('Distribution Method')}</label>
              <p className="text-xs text-muted-foreground">
                {t('Skipped — assignments come straight from the Sheet Distribution table above, not Run Auto-Distribution.')}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">{t('Distribution Method')}</label>
              <p className="text-xs text-muted-foreground">{t('How debtors will be split across agents')}</p>
              <div className="grid grid-cols-1 gap-2">
                <label className="flex items-start gap-3 p-3 rounded-lg border-2 border-primary bg-primary/5 cursor-pointer">
                  <input type="radio" value="balance_range" defaultChecked className="mt-0.5 accent-primary" {...register('splitMethod')} />
                  <div>
                    <p className="text-sm font-semibold text-foreground">{t('Balance Range Split')}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t('Debtors split into 4 bands ({0}) and distributed evenly across agents so each agent receives a comparable mix of easier and harder accounts.', BAND_RANGE_LABELS.join(', '))}
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* Info box */}
          <div className="flex items-start gap-2 p-3 bg-[var(--info-bg)] border border-[#BFDBFE] rounded-lg text-xs text-info">
            <CheckCircle size={13} className="mt-0.5 shrink-0" />
            <span>{t('Call history is preserved on reassignment. If an agent leaves mid-file, their debtors transfer to another agent with full call logs intact.')}</span>
          </div>
        </form>
      </Modal>

      {/* Sync Update Modal — for a client (e.g. Zenka) whose daily file is a full
          accumulating export against an already-existing file: a calling-list sheet
          (diffed for genuinely new loans, auto-distributed) and a payments sheet
          (this month's payments only, applied once each). */}
      <Modal
        open={syncModalOpen}
        onClose={() => { setSyncModalOpen(false); resetSyncModalState(); }}
        title={t('Sync Update')}
        subtitle={selectedFile ? t('Pick up new loans and this month\'s payments for {0}', selectedFile.batchLabel) : undefined}
        size="lg"
        footer={
          <>
            <button
              type="button"
              onClick={() => { setSyncModalOpen(false); resetSyncModalState(); }}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
            >
              {t('Cancel')}
            </button>
            <button
              type="button"
              onClick={onSubmitSync}
              disabled={isSyncing || isSyncPreviewing || !syncPreview || !mappingIsComplete(callingListMapping) || !paymentMappingIsComplete(paymentMapping) || offlineBlocked}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100"
            >
              {isSyncing ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>{t('Queuing…')}</span>
                </>
              ) : (
                <>
                  <RefreshCcw size={15} />
                  <span>{t('Run Sync')}</span>
                </>
              )}
            </button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">{t('Daily File')}{' '}<span className="text-negative">*</span></label>
            <p className="text-xs text-muted-foreground">{t('One file, first sheet = calling list, second sheet = payments — any column headers are fine, confirm the mapping below.')}</p>
            <label className="block border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer border-border hover:border-primary/50 bg-secondary/20">
              <input
                type="file"
                accept=".xlsx,.xlsb"
                className="sr-only"
                onChange={(e) => onSyncFileSelected(e.target.files?.[0] ?? null)}
              />
              <Upload size={24} className="text-muted-foreground mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground">{syncUploadFile ? syncUploadFile.name : t('Click to browse')}</p>
              <p className="text-xs text-muted-foreground mt-1">{t('Accepts .xlsx or .xlsb files')}</p>
            </label>
          </div>

          {isSyncPreviewing && <p className="text-sm text-muted-foreground">{t('Reading sheets…')}</p>}

          {syncPreview && (
            <>
              <FileCurrencySelect value={syncCurrency} onChange={setSyncCurrency} />

              {/* Calling list mapping */}
              <div className="space-y-4 p-4 bg-secondary/30 rounded-xl border border-border">
                <div>
                  <p className="text-sm font-semibold text-foreground">{t('Calling List Sheet — "{0}"', syncPreview.callingList.sheetName)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t('Any loan not already on this file gets created and auto-distributed. Existing loans are left untouched.')}</p>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-foreground uppercase tracking-wide">{t('Name')}{' '}<span className="text-negative">*</span></label>
                    <div className="flex items-center gap-1 text-xs">
                      <button type="button" onClick={() => setCallingListMapping((m) => ({ ...m, nameMode: 'single' }))} className={`px-2 py-0.5 rounded-full ${callingListMapping.nameMode === 'single' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>{t('One column')}</button>
                      <button type="button" onClick={() => setCallingListMapping((m) => ({ ...m, nameMode: 'split' }))} className={`px-2 py-0.5 rounded-full ${callingListMapping.nameMode === 'split' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>{t('First / Last')}</button>
                    </div>
                  </div>
                  {callingListMapping.nameMode === 'single' ? (
                    <select
                      value={callingListMapping.nameCol}
                      onChange={(e) => setCallingListMapping((m) => ({ ...m, nameCol: e.target.value }))}
                      className="w-full px-3 py-2 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
                    >
                      <option value="">{t('Select column…')}</option>
                      {syncPreview.callingList.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {(['firstNameCol', 'lastNameCol', 'middleNameCol'] as const).map((field, idx) => (
                        <select
                          key={field}
                          value={callingListMapping[field]}
                          onChange={(e) => setCallingListMapping((m) => ({ ...m, [field]: e.target.value }))}
                          className="w-full px-2 py-2 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
                        >
                          <option value="">{t(['First…', 'Last…', 'Middle (optional)…'][idx])}</option>
                          {syncPreview.callingList.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                        </select>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {([
                    ['phone1Col', 'Phone', true],
                    ['loanRefCol', 'Loan Ref', true],
                    ['amountOwedCol', 'Amount Owed', true],
                  ] as const).map(([field, label, required]) => (
                    <div key={field} className="space-y-1">
                      <label className="text-xs font-semibold text-foreground uppercase tracking-wide">{t(label)}{required && <span className="text-negative"> *</span>}</label>
                      <select
                        value={callingListMapping[field]}
                        onChange={(e) => setCallingListMapping((m) => ({ ...m, [field]: e.target.value }))}
                        className="w-full px-3 py-2 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
                      >
                        <option value="">{required ? t('Select column…') : t('Same as Amount Owed')}</option>
                        {syncPreview.callingList.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Payments mapping */}
              <div className="space-y-4 p-4 bg-secondary/30 rounded-xl border border-border">
                <div>
                  <p className="text-sm font-semibold text-foreground">{t('Payments Sheet — "{0}"', syncPreview.payments.sheetName)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t('Only this calendar month\'s payments are applied, and only once each — safe to re-run daily even though the sheet resends history.')}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    ['loanRefCol', 'Loan Ref', true],
                    ['paidDateCol', 'Payment Date', true],
                    ['paidAmountCol', 'Payment Amount', true],
                    ['companyCommissionCol', 'Company Commission (optional)', false],
                  ] as const).map(([field, label, required]) => (
                    <div key={field} className="space-y-1">
                      <label className="text-xs font-semibold text-foreground uppercase tracking-wide">{t(label)}{required && <span className="text-negative"> *</span>}</label>
                      <select
                        value={paymentMapping[field]}
                        onChange={(e) => setPaymentMapping((m) => ({ ...m, [field]: e.target.value }))}
                        className="w-full px-3 py-2 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
                      >
                        <option value="">{required ? t('Select column…') : t('Not tracked')}</option>
                        {syncPreview.payments.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Edit File */}
      <Modal
        open={!!editingFile}
        onClose={() => setEditingFile(null)}
        title={t('Edit File')}
        subtitle={editingFile ? t('{0} — {1} debtor(s)', editingFile.client, editingFile.debtorCount.toLocaleString()) : undefined}
        footer={
          <>
            <button
              onClick={() => setEditingFile(null)}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
            >
              {t('Cancel')}
            </button>
            <button
              form="edit-file-form"
              type="submit"
              disabled={isSavingFile || offlineBlocked}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition-all disabled:opacity-60"
            >
              {isSavingFile ? t('Saving…') : t('Save Changes')}
            </button>
          </>
        }
      >
        <form id="edit-file-form" onSubmit={editForm.handleSubmit(onSubmitEditFile)} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">{t('Batch Label')}{' '}<span className="text-negative">*</span></label>
            <input
              className={`w-full px-3 py-2.5 text-sm bg-input border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 ${editForm.formState.errors.batchLabel ? 'border-negative' : 'border-border'}`}
              {...editForm.register('batchLabel', { required: t('Enter a batch label') })}
            />
            {editForm.formState.errors.batchLabel && <p className="text-xs text-negative">{t(editForm.formState.errors.batchLabel.message)}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">{t('Date Received')}</label>
            <input
              type="date"
              className="w-full px-3 py-2.5 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
              {...editForm.register('receivedDate')}
            />
          </div>
          <label className="flex items-center gap-2.5 text-sm text-foreground cursor-pointer">
            <input type="checkbox" className="accent-primary" {...editForm.register('isMidMonthTopup')} />
            {t('Mid-month top-up')}
          </label>
          <p className="text-xs text-muted-foreground">
            {tx('Client ({0}) can\'t be changed — delete and re-import under the correct client if this was imported wrong.', <span className="font-medium text-foreground">{editingFile?.client}</span>)}
          </p>
        </form>
      </Modal>

      {/* Start New Month — per client. Downloads an export of everything it's about to
          clear, then removes last month's reconciliations (balances are kept, not
          reversed), rebases what's outstanding as the new total, and drops zero-balance
          debtors. Deleting a file the client has replaced stays a separate manual step. */}
      <Modal
        open={newMonthOpen}
        onClose={() => { setNewMonthOpen(false); resetNewMonthState(); }}
        title={t('Start New Month')}
        subtitle={t('Reset one client\'s books for the new month')}
        size="lg"
        footer={
          <>
            <button
              type="button"
              onClick={() => { setNewMonthOpen(false); resetNewMonthState(); }}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
            >
              {t('Cancel')}
            </button>
            <button
              type="button"
              onClick={onStartNewMonth}
              disabled={
                isStartingNewMonth || offlineBlocked || !newMonthPlan ||
                newMonthPlan.reconciliations.some((r) => r.busy) ||
                newMonthConfirm.trim().toLowerCase() !== newMonthPlan.clientName.trim().toLowerCase()
              }
              className="flex items-center gap-2 px-4 py-2 bg-negative text-white text-sm font-semibold rounded-lg hover:bg-negative/90 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100"
            >
              <CalendarClock size={15} />
              <span>{isStartingNewMonth ? t('Exporting & starting…') : t('Export & Start New Month')}</span>
            </button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              {t('Client')}{' '}<span className="text-negative">*</span>
            </label>
            <select
              value={newMonthClientId}
              onChange={(e) => onNewMonthClientChange(e.target.value)}
              className="w-full px-3 py-2.5 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
            >
              <option value="">{t('Select client…')}</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {isLoadingNewMonth && <p className="text-sm text-muted-foreground">{t('Checking what would change…')}</p>}

          {newMonthPlan && (
            <div className="space-y-4">
              <ol className="space-y-2 text-sm text-foreground list-decimal pl-5">
                <li>
                  {tx('{0} reconciliation(s) received before {1} are cleared ({2} payment(s) from {3} debtor(s), {4} recovered; {5} zero-payment rows also go). Balances are {6} put back — last month\'s recoveries simply stop counting.', <strong>{newMonthPlan.reconciliations.length}</strong>, formatDate(newMonthPlan.cutoff), newMonthPlan.paidEntryCount.toLocaleString(), newMonthPlan.paidDebtorCount.toLocaleString(), formatMoneyMB(newMonthPlan.recoveredTotal), (newMonthPlan.entryCount - newMonthPlan.paidEntryCount).toLocaleString(), <strong>{t('not')}</strong>)}
                </li>
                <li>
                  {tx('Everything still outstanding becomes the new total: {0} across {1} debtor(s).', <strong>{formatMoneyMB(newMonthPlan.outstandingTotal)}</strong>, newMonthPlan.debtorCount.toLocaleString())}
                </li>
                <li>
                  {tx('{0} debtor(s) with a 0 balance are removed, with their calls.', <strong>{newMonthPlan.clearedDebtorCount.toLocaleString()}</strong>)}
                  {newMonthPlan.keptZeroBalanceCount > 0 && (' ' + t('{0} that paid in a reconciliation received this month are kept so that recovery still shows.', newMonthPlan.keptZeroBalanceCount))}
                </li>
              </ol>

              {newMonthPlan.filesEmptied.length > 0 && (
                <div className="p-3 bg-secondary/40 border border-border rounded-lg text-xs text-foreground">
                  <p className="font-semibold mb-1">{t('These batches will be left empty — delete them from the list once you\'ve confirmed they\'re replaced:')}</p>
                  <p>{newMonthPlan.filesEmptied.map((f) => f.batchLabel).join(', ')}</p>
                </div>
              )}

              {newMonthPlan.reconciliations.some((r) => r.busy) && (
                <div className="p-3 bg-[var(--negative-bg)] border border-negative/30 rounded-lg text-xs text-negative">
                  {t('A reconciliation is still being processed — wait for it to finish before starting the new month.')}
                </div>
              )}

              <div className="p-3 bg-[var(--negative-bg)] border border-negative/30 rounded-lg text-xs text-negative">
                {t('A workbook of everything above downloads first; if that fails, nothing is changed. This can\'t be undone.')}
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-foreground">
                  {tx('Type {0} to confirm', <span className="font-semibold">{newMonthPlan.clientName}</span>)}
                </label>
                <input
                  value={newMonthConfirm}
                  onChange={(e) => setNewMonthConfirm(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
                />
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Remove Accounts (insourced) — for a client that's taken a batch of accounts
          back. Matches a list of loan/account refs against that client's debtors across
          every file batch they've ever had (not just one), then permanently deletes only
          what the admin confirms in the preview below. */}
      <Modal
        open={removeModalOpen}
        onClose={() => { setRemoveModalOpen(false); resetRemoveModalState(); }}
        title={t('Remove Insourced Accounts')}
        subtitle={t('Upload the client\'s list of accounts taken back — matched across all of that client\'s file batches')}
        size="lg"
        footer={
          <>
            <button
              type="button"
              onClick={() => { setRemoveModalOpen(false); resetRemoveModalState(); }}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
            >
              {t('Cancel')}
            </button>
            <button
              type="button"
              onClick={onConfirmRemove}
              disabled={isRemoving || removeSelectedIds.size === 0 || offlineBlocked}
              className="flex items-center gap-2 px-4 py-2 bg-negative text-white text-sm font-semibold rounded-lg hover:bg-negative/90 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100"
            >
              {isRemoving ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>{t('Removing…')}</span>
                </>
              ) : (
                <>
                  <Trash2 size={15} />
                  <span>{removeSelectedIds.size === 0 ? t('Delete Accounts') : removeSelectedIds.size === 1 ? t('Delete {0} Account', removeSelectedIds.size) : t('Delete {0} Accounts', removeSelectedIds.size)}</span>
                </>
              )}
            </button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              {t('Client')}{' '}<span className="text-negative">*</span>
            </label>
            <select
              value={removeClientId}
              onChange={(e) => onRemoveClientChange(e.target.value)}
              className="w-full px-3 py-2.5 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
            >
              <option value="">{t('Select client…')}</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              {t('List of Accounts')}{' '}<span className="text-negative">*</span>
            </label>
            <p className="text-xs text-muted-foreground">
              {t('The loan/account reference in the first column, one per row — a header row is fine and skipped automatically.')}
            </p>
            <label
              className={`block border-2 border-dashed rounded-xl p-8 text-center transition-colors ${removeClientId ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'} ${isRemoveDragOver ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50 bg-secondary/20'}`}
              onDragOver={(e) => { e.preventDefault(); if (removeClientId) setIsRemoveDragOver(true); }}
              onDragLeave={() => setIsRemoveDragOver(false)}
              onDrop={removeClientId ? onDropRemoveUploadFile : (e) => e.preventDefault()}
            >
              <input
                type="file"
                accept=".xlsx,.xlsb,.csv"
                className="sr-only"
                disabled={!removeClientId}
                onChange={(e) => onRemoveFileSelected(e.target.files?.[0] ?? null)}
              />
              <Upload size={24} className="text-muted-foreground mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground">
                {!removeClientId ? t('Select a client first') : removeUploadFile ? removeUploadFile.name : (isRemoveDragOver ? t('Drop the file here') : t('Click to browse, or drag a file here'))}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{t('Accepts .xlsx, .xlsb, or .csv files')}</p>
            </label>
          </div>

          {isRemovePreviewing && <p className="text-sm text-muted-foreground">{t('Matching accounts…')}</p>}

          {removePreview && (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-sm font-semibold text-foreground">
                  {removePreview.unmatchedRefs.length > 0
                    ? (removePreview.matched.length === 1
                        ? t('{0} account matched, {1} reference(s) not found', removePreview.matched.length, removePreview.unmatchedRefs.length)
                        : t('{0} accounts matched, {1} reference(s) not found', removePreview.matched.length, removePreview.unmatchedRefs.length))
                    : (removePreview.matched.length === 1
                        ? t('{0} account matched', removePreview.matched.length)
                        : t('{0} accounts matched', removePreview.matched.length))}
                </p>
                {removePreview.matched.length > 0 && (
                  <div className="flex items-center gap-2 text-xs">
                    <button type="button" onClick={() => setRemoveSelectedIds(new Set(removePreview.matched.map((m) => m.id)))} className="text-primary hover:underline">{t('All')}</button>
                    <button type="button" onClick={() => setRemoveSelectedIds(new Set())} className="text-muted-foreground hover:underline">{t('None')}</button>
                  </div>
                )}
              </div>

              {removePreview.matched.length > 0 && (
                <div className="max-h-64 overflow-y-auto scrollbar-thin overflow-x-auto border border-border rounded-lg bg-card">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-secondary/90 backdrop-blur">
                      <tr className="border-b border-border">
                        <th className="px-2 py-1.5 text-left w-8"></th>
                        <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground whitespace-nowrap">{t('Loan Ref')}</th>
                        <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground whitespace-nowrap">{t('Name')}</th>
                        <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground whitespace-nowrap">{t('Batch')}</th>
                        <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground whitespace-nowrap">{t('Agent')}</th>
                        <th className="px-2 py-1.5 text-right font-semibold text-muted-foreground whitespace-nowrap">{t('Balance')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {removePreview.matched.map((m) => (
                        <tr key={m.id} className="border-b border-border/60 last:border-0">
                          <td className="px-2 py-1.5">
                            <input type="checkbox" className="accent-primary" checked={removeSelectedIds.has(m.id)} onChange={() => toggleRemoveSelected(m.id)} />
                          </td>
                          <td className="px-2 py-1.5 whitespace-nowrap font-mono-data text-foreground">{m.loanRef}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap text-foreground">{m.name}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">{m.batchLabel}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">{m.agentName ?? '—'}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap text-right font-tabular text-foreground">{formatMoneyMB(m.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {removePreview.unmatchedRefs.length > 0 && (
                <div className="p-3 bg-[var(--negative-bg)] border border-negative/30 rounded-lg text-xs text-negative">
                  <p className="font-semibold mb-1">{t('Not found — check for typos or an already-removed account:')}</p>
                  <p className="font-mono-data break-all">{removePreview.unmatchedRefs.join(', ')}</p>
                </div>
              )}

              <div className="flex items-start gap-2 p-3 bg-[var(--negative-bg)] border border-negative/30 rounded-lg text-xs text-negative">
                <span>{t('Deleting is permanent — it removes the selected accounts and every call logged against them. There is no undo.')}</span>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}