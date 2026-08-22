'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { Building2, Tags, Server, ShieldCheck, Percent, Plus, Pencil, Trash2 } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import DispositionBadge from '@/components/ui/DispositionBadge';
import Modal from '@/components/ui/Modal';
import { toast } from 'sonner';
import { getCached, setCached } from '@/lib/offline-cache';
import { useOfflineGuard } from '@/lib/use-offline-guard';

interface ClientOption {
  id: string;
  name: string;
  reconciliationType: string;
  reportingFrequency: string;
}

interface DispositionCode {
  code: string;
  label: string;
  description: string | null;
  color: string;
  requiresCallback: boolean;
  requiresPtp: boolean;
}

interface ClientForm {
  name: string;
  reconciliationType: 'full' | 'partial';
  reportingFrequency: 'daily' | 'weekly' | 'monthly';
}

interface CodeForm {
  code: string;
  label: string;
  description: string;
  color: string;
  requiresCallback: boolean;
  requiresPtp: boolean;
}

interface CommissionRateRow {
  id: string;
  clientId: string;
  bucket: string;
  rate: number; // fraction, e.g. 0.07 for 7%
}

interface RateForm {
  bucket: string;
  ratePercent: string; // entered as a whole percent (e.g. "7"), converted to a fraction on submit
}

// Mirrors src/lib/commission.ts's BUCKET_ORDER/BUCKET_LABELS — duplicated rather than
// imported because that module also imports the Prisma client (server-only) and this is
// a 'use client' component.
const BUCKET_OPTIONS = [
  { value: 'B30', label: '30–59' },
  { value: 'B60', label: '60–89' },
  { value: 'B90', label: '90–120' },
  { value: 'B120', label: 'Above 120' },
  { value: 'WO', label: 'Written off' },
] as const;
const BUCKET_LABEL_BY_KEY: Record<string, string> = Object.fromEntries(BUCKET_OPTIONS.map((b) => [b.value, b.label]));

export default function AdminSettingsContent() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [codes, setCodes] = useState<DispositionCode[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // null = closed; {} shape with id === '' means "add new"
  const [editingClient, setEditingClient] = useState<ClientOption | null>(null);
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [editingCode, setEditingCode] = useState<DispositionCode | null>(null);
  const [codeModalOpen, setCodeModalOpen] = useState(false);

  // Commission rates are per-client (unlike disposition codes, which are global), so this
  // needs its own client selector rather than one flat list — see lib/commission.ts for
  // why this exists at all (KCB Mopesa's per-aging-bucket commission structure).
  const [rateClientId, setRateClientId] = useState('');
  const [rates, setRates] = useState<CommissionRateRow[]>([]);
  const [editingRate, setEditingRate] = useState<CommissionRateRow | null>(null);
  const [rateModalOpen, setRateModalOpen] = useState(false);

  const clientForm = useForm<ClientForm>({ defaultValues: { name: '', reconciliationType: 'partial', reportingFrequency: 'weekly' } });
  const codeForm = useForm<CodeForm>({ defaultValues: { code: '', label: '', description: '', color: '#64748B', requiresCallback: false, requiresPtp: false } });
  const rateForm = useForm<RateForm>({ defaultValues: { bucket: 'B30', ratePercent: '' } });
  const { blocked: offlineBlocked } = useOfflineGuard();

  // Bespoke, not useCachedQuery — "not authorized" (wrong role) must never be confused
  // with "couldn't reach the server". Cache-first: render last-known clients/codes
  // instantly if this admin has loaded this screen before, then let a live response
  // (including an actual 403-equivalent role check) override it.
  const load = useCallback(async () => {
    const [cachedMe, cachedClients, cachedCodes] = await Promise.all([
      getCached<{ user: { role: string } | null }>('/api/auth/me'),
      getCached<{ clients: ClientOption[] }>('/api/clients'),
      getCached<{ codes: DispositionCode[] }>('/api/disposition-codes'),
    ]);
    if (cachedMe?.user?.role === 'admin') {
      setAuthorized(true);
      if (cachedClients) setClients(cachedClients.clients ?? []);
      if (cachedCodes) setCodes(cachedCodes.codes ?? []);
    }

    try {
      const meRes = await fetch('/api/auth/me');
      const me = await meRes.json();
      await setCached('/api/auth/me', me);
      if (me.user?.role !== 'admin') {
        setAuthorized(false);
        return;
      }
      setAuthorized(true);
      const [clientsRes, codesRes] = await Promise.all([
        fetch('/api/clients').then((r) => r.json()),
        fetch('/api/disposition-codes').then((r) => r.json()),
      ]);
      setClients(clientsRes.clients ?? []);
      setCodes(codesRes.codes ?? []);
      await Promise.all([setCached('/api/clients', clientsRes), setCached('/api/disposition-codes', codesRes)]);
    } catch {
      // Offline — whatever was set from cache above (if anything) stands as-is.
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (authorized === false) router.replace('/agent-dashboard'); }, [authorized, router]);

  // Not cache-first like `load` above — this is parameterized by whichever client is
  // selected, so there's no single stable cache key for it, and it's an admin-only config
  // screen that already requires being online to edit anyway.
  const loadRates = useCallback(async (clientId: string) => {
    if (!clientId) { setRates([]); return; }
    try {
      const res = await fetch(`/api/commission-rates?clientId=${clientId}`);
      const payload = await res.json();
      setRates(payload.rates ?? []);
    } catch {
      setRates([]);
    }
  }, []);

  useEffect(() => { loadRates(rateClientId); }, [rateClientId, loadRates]);
  useEffect(() => { if (!rateClientId && clients.length > 0) setRateClientId(clients[0].id); }, [clients, rateClientId]);

  function openAddClient() {
    setEditingClient(null);
    clientForm.reset({ name: '', reconciliationType: 'partial', reportingFrequency: 'weekly' });
    setClientModalOpen(true);
  }

  function openEditClient(c: ClientOption) {
    setEditingClient(c);
    clientForm.reset({ name: c.name, reconciliationType: c.reconciliationType as 'full' | 'partial', reportingFrequency: c.reportingFrequency as 'daily' | 'weekly' | 'monthly' });
    setClientModalOpen(true);
  }

  async function onSubmitClient(data: ClientForm) {
    setIsSaving(true);
    try {
      const res = await fetch(editingClient ? `/api/clients/${editingClient.id}` : '/api/clients', {
        method: editingClient ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || 'Could not save client');
        return;
      }
      toast.success(editingClient ? `${data.name} updated` : `${data.name} added — it'll show up in Files and Reports right away`);
      setClientModalOpen(false);
      await load();
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteClient(c: ClientOption) {
    if (!window.confirm(`Delete ${c.name}? This only works if it has no file batches.`)) return;
    const res = await fetch(`/api/clients/${c.id}`, { method: 'DELETE' });
    const payload = await res.json();
    if (!res.ok) {
      toast.error(payload.error || 'Could not delete client');
      return;
    }
    toast.success(`${c.name} deleted`);
    await load();
  }

  function openAddCode() {
    setEditingCode(null);
    codeForm.reset({ code: '', label: '', description: '', color: '#64748B', requiresCallback: false, requiresPtp: false });
    setCodeModalOpen(true);
  }

  function openEditCode(c: DispositionCode) {
    setEditingCode(c);
    codeForm.reset({ code: c.code, label: c.label, description: c.description ?? '', color: c.color, requiresCallback: c.requiresCallback, requiresPtp: c.requiresPtp });
    setCodeModalOpen(true);
  }

  async function onSubmitCode(data: CodeForm) {
    setIsSaving(true);
    try {
      const res = await fetch(editingCode ? `/api/disposition-codes/${editingCode.code}` : '/api/disposition-codes', {
        method: editingCode ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || 'Could not save disposition code');
        return;
      }
      toast.success(editingCode ? `${data.code} updated` : `${data.code} added — agents will see it immediately`);
      setCodeModalOpen(false);
      await load();
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteCode(c: DispositionCode) {
    if (!window.confirm(`Delete ${c.code} — ${c.label}? This only works if no call log uses it.`)) return;
    const res = await fetch(`/api/disposition-codes/${c.code}`, { method: 'DELETE' });
    const payload = await res.json();
    if (!res.ok) {
      toast.error(payload.error || 'Could not delete disposition code');
      return;
    }
    toast.success(`${c.code} deleted`);
    await load();
  }

  function openAddRate() {
    setEditingRate(null);
    const nextBucket = BUCKET_OPTIONS.find((b) => !rates.some((r) => r.bucket === b.value))?.value ?? 'B30';
    rateForm.reset({ bucket: nextBucket, ratePercent: '' });
    setRateModalOpen(true);
  }

  function openEditRate(r: CommissionRateRow) {
    setEditingRate(r);
    rateForm.reset({ bucket: r.bucket, ratePercent: String(Math.round(r.rate * 1000) / 10) });
    setRateModalOpen(true);
  }

  async function onSubmitRate(data: RateForm) {
    setIsSaving(true);
    try {
      const rate = Number(data.ratePercent) / 100;
      const res = await fetch(editingRate ? `/api/commission-rates/${editingRate.id}` : '/api/commission-rates', {
        method: editingRate ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingRate ? { rate } : { clientId: rateClientId, bucket: data.bucket, rate }),
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || 'Could not save commission rate');
        return;
      }
      toast.success(editingRate ? 'Rate updated' : 'Rate added');
      setRateModalOpen(false);
      await loadRates(rateClientId);
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteRate(r: CommissionRateRow) {
    if (!window.confirm(`Delete the ${BUCKET_LABEL_BY_KEY[r.bucket] ?? r.bucket} commission rate for this client?`)) return;
    const res = await fetch(`/api/commission-rates/${r.id}`, { method: 'DELETE' });
    const payload = await res.json();
    if (!res.ok) {
      toast.error(payload.error || 'Could not delete rate');
      return;
    }
    toast.success('Rate deleted');
    await loadRates(rateClientId);
  }

  if (authorized === null) {
    return <div className="p-6 xl:p-8 2xl:p-10 max-w-screen-2xl mx-auto"><p className="text-sm text-muted-foreground">Loading…</p></div>;
  }
  if (authorized === false) return null;

  return (
    <div className="p-6 xl:p-8 2xl:p-10 max-w-screen-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-page-title text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">System configuration for the Uganda branch</p>
      </div>

      <div className="bg-card rounded-xl shadow-card border border-border p-5">
        <div className="flex items-center gap-2 mb-4">
          <Building2 size={16} className="text-primary" />
          <h2 className="text-section-header text-foreground">Branch</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Branch</p>
            <p className="text-sm font-semibold text-foreground">Uganda</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Clients</p>
            <p className="text-sm font-semibold text-foreground">{clients.length}</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Every record carries this branch field from day one, per the requirements doc — Uganda is the only
          value in use today, but the schema is ready if WellcashOps is adopted by other country branches.
        </p>
      </div>

      <div className="bg-card rounded-xl shadow-card border border-border">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-primary" />
            <h2 className="text-section-header text-foreground">Clients</h2>
          </div>
          <button
            onClick={openAddClient}
            disabled={offlineBlocked}
            title={offlineBlocked ? 'Offline — reconnect to add a client' : undefined}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Plus size={14} />
            Add Client
          </button>
        </div>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-table-cell">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                {['Client', 'Reconciliation Format', 'Reporting Frequency', ''].map((col) => (
                  <th key={col} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className="border-b border-border/60 hover:bg-secondary/30 transition-colors group">
                  <td className="px-4 py-3 font-medium text-foreground text-sm">{c.name}</td>
                  <td className="px-4 py-3">
                    <Badge variant={c.reconciliationType === 'full' ? 'info' : 'default'}>
                      {c.reconciliationType === 'full' ? 'Full' : 'Partial'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground capitalize">{c.reportingFrequency}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEditClient(c)} disabled={offlineBlocked} className="p-1.5 rounded-md hover:bg-primary/10 hover:text-primary transition-colors text-muted-foreground disabled:opacity-40" title={offlineBlocked ? 'Offline — reconnect to edit' : 'Edit'}>
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => deleteClient(c)} disabled={offlineBlocked} className="p-1.5 rounded-md hover:bg-[var(--negative-bg)] hover:text-negative transition-colors text-muted-foreground disabled:opacity-40" title={offlineBlocked ? 'Offline — reconnect to delete' : 'Delete'}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {clients.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">No clients yet — add one to get started.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-card rounded-xl shadow-card border border-border">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Tags size={16} className="text-primary" />
            <h2 className="text-section-header text-foreground">Disposition Codes</h2>
          </div>
          <button
            onClick={openAddCode}
            disabled={offlineBlocked}
            title={offlineBlocked ? 'Offline — reconnect to add a code' : undefined}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Plus size={14} />
            Add Code
          </button>
        </div>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-table-cell">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                {['Code', 'Label', 'Description', 'Callback', 'PTP', ''].map((col) => (
                  <th key={col} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.code} className="border-b border-border/60 hover:bg-secondary/30 transition-colors group">
                  <td className="px-4 py-2.5"><DispositionBadge code={c.code} color={c.color} /></td>
                  <td className="px-4 py-2.5 text-sm text-foreground">{c.label}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{c.description}</td>
                  <td className="px-4 py-2.5">{c.requiresCallback && <Badge variant="info">Yes</Badge>}</td>
                  <td className="px-4 py-2.5">{c.requiresPtp && <Badge variant="positive">Yes</Badge>}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEditCode(c)} disabled={offlineBlocked} className="p-1.5 rounded-md hover:bg-primary/10 hover:text-primary transition-colors text-muted-foreground disabled:opacity-40" title={offlineBlocked ? 'Offline — reconnect to edit' : 'Edit'}>
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => deleteCode(c)} disabled={offlineBlocked} className="p-1.5 rounded-md hover:bg-[var(--negative-bg)] hover:text-negative transition-colors text-muted-foreground disabled:opacity-40" title={offlineBlocked ? 'Offline — reconnect to delete' : 'Delete'}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-card rounded-xl shadow-card border border-border">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Percent size={16} className="text-primary" />
            <h2 className="text-section-header text-foreground">Commission Rates</h2>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={rateClientId}
              onChange={(e) => setRateClientId(e.target.value)}
              className="text-sm bg-input border border-border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring/50"
            >
              {clients.length === 0 && <option value="">No clients yet</option>}
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button
              onClick={openAddRate}
              disabled={offlineBlocked || !rateClientId || rates.length >= BUCKET_OPTIONS.length}
              title={!rateClientId ? 'Select a client first' : rates.length >= BUCKET_OPTIONS.length ? 'Every bucket already has a rate' : offlineBlocked ? 'Offline — reconnect to add a rate' : undefined}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Plus size={14} />
              Add Rate
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground px-5 pt-3">
          Only applies to a client whose reconciliation files carry aging buckets by sheet (currently
          KCB Mopesa) — a client with no rates configured here is completely unaffected. A bucket left
          unconfigured falls back to a standard rate (4/7/9/10/10%) rather than earning nothing.
        </p>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-table-cell">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                {['Aging Band', 'Rate', ''].map((col) => (
                  <th key={col} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.id} className="border-b border-border/60 hover:bg-secondary/30 transition-colors group">
                  <td className="px-4 py-2.5 text-sm text-foreground">{BUCKET_LABEL_BY_KEY[r.bucket] ?? r.bucket}</td>
                  <td className="px-4 py-2.5 text-sm font-tabular text-foreground">{(r.rate * 100).toFixed(1)}%</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEditRate(r)} disabled={offlineBlocked} className="p-1.5 rounded-md hover:bg-primary/10 hover:text-primary transition-colors text-muted-foreground disabled:opacity-40" title={offlineBlocked ? 'Offline — reconnect to edit' : 'Edit'}>
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => deleteRate(r)} disabled={offlineBlocked} className="p-1.5 rounded-md hover:bg-[var(--negative-bg)] hover:text-negative transition-colors text-muted-foreground disabled:opacity-40" title={offlineBlocked ? 'Offline — reconnect to delete' : 'Delete'}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {rateClientId && rates.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-sm text-muted-foreground">No commission rates set for this client — standard rates (4/7/9/10/10%) apply until you add some.</td></tr>
              )}
              {!rateClientId && (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-sm text-muted-foreground">Add a client first.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-card rounded-xl shadow-card border border-border p-5">
        <div className="flex items-center gap-2 mb-2">
          <Server size={16} className="text-primary" />
          <h2 className="text-section-header text-foreground">Hosting</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Local dev uses a SQLite file. Production must point <code className="font-mono-data">DATABASE_URL</code> at
          a self-hosted PostgreSQL instance — no third-party service may hold client data (a standing
          requirement from KCB, HFB, and other clients).
        </p>
      </div>

      {/* Client add/edit modal */}
      <Modal
        open={clientModalOpen}
        onClose={() => setClientModalOpen(false)}
        title={editingClient ? 'Edit Client' : 'Add Client'}
        subtitle="Changes appear immediately in file import, reconciliation, and reports"
        footer={
          <>
            <button
              onClick={() => setClientModalOpen(false)}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              form="client-form"
              type="submit"
              disabled={isSaving || offlineBlocked}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition-all disabled:opacity-60"
            >
              <Plus size={15} />
              {isSaving ? 'Saving…' : editingClient ? 'Save Changes' : 'Add Client'}
            </button>
          </>
        }
      >
        <form id="client-form" onSubmit={clientForm.handleSubmit(onSubmitClient)} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">Client Name <span className="text-negative">*</span></label>
            <input
              placeholder="e.g. Airtel"
              className={`w-full px-3 py-2.5 text-sm bg-input border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 ${clientForm.formState.errors.name ? 'border-negative' : 'border-border'}`}
              {...clientForm.register('name', { required: 'Enter a client name' })}
            />
            {clientForm.formState.errors.name && <p className="text-xs text-negative">{clientForm.formState.errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">Reconciliation Format</label>
            <p className="text-xs text-muted-foreground">Which format this client sends — see §7 for what each means</p>
            <select className="w-full px-3 py-2.5 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50" {...clientForm.register('reconciliationType')}>
              <option value="partial">Partial (paid-only)</option>
              <option value="full">Full</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">Reporting Frequency</label>
            <select className="w-full px-3 py-2.5 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50" {...clientForm.register('reportingFrequency')}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
        </form>
      </Modal>

      {/* Disposition code add/edit modal */}
      <Modal
        open={codeModalOpen}
        onClose={() => setCodeModalOpen(false)}
        title={editingCode ? 'Edit Disposition Code' : 'Add Disposition Code'}
        subtitle="Shows up in the call-logging form, reports, and dashboards immediately"
        footer={
          <>
            <button
              onClick={() => setCodeModalOpen(false)}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              form="code-form"
              type="submit"
              disabled={isSaving || offlineBlocked}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition-all disabled:opacity-60"
            >
              <Plus size={15} />
              {isSaving ? 'Saving…' : editingCode ? 'Save Changes' : 'Add Code'}
            </button>
          </>
        }
      >
        <form id="code-form" onSubmit={codeForm.handleSubmit(onSubmitCode)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">Code <span className="text-negative">*</span></label>
              <input
                placeholder="e.g. VM"
                disabled={!!editingCode}
                className={`w-full px-3 py-2.5 text-sm bg-input border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 uppercase disabled:opacity-60 disabled:cursor-not-allowed ${codeForm.formState.errors.code ? 'border-negative' : 'border-border'}`}
                {...codeForm.register('code', { required: 'Enter a short code', pattern: { value: /^[A-Za-z0-9]{1,6}$/, message: '1-6 letters/numbers' } })}
              />
              {codeForm.formState.errors.code && <p className="text-xs text-negative">{codeForm.formState.errors.code.message}</p>}
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">Color</label>
              <input type="color" className="w-full h-[42px] px-1 py-1 bg-input border border-border rounded-lg cursor-pointer" {...codeForm.register('color')} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">Label <span className="text-negative">*</span></label>
            <input
              placeholder="e.g. Voicemail"
              className={`w-full px-3 py-2.5 text-sm bg-input border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 ${codeForm.formState.errors.label ? 'border-negative' : 'border-border'}`}
              {...codeForm.register('label', { required: 'Enter a label' })}
            />
            {codeForm.formState.errors.label && <p className="text-xs text-negative">{codeForm.formState.errors.label.message}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">Description</label>
            <textarea
              rows={2}
              placeholder="Shown as a hint under the disposition selector"
              className="w-full px-3 py-2 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 resize-none"
              {...codeForm.register('description')}
            />
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input type="checkbox" className="accent-primary" {...codeForm.register('requiresCallback')} />
              Prompts for a callback date
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input type="checkbox" className="accent-primary" {...codeForm.register('requiresPtp')} />
              Prompts for PTP amount/date
            </label>
          </div>
        </form>
      </Modal>

      {/* Commission rate add/edit modal */}
      <Modal
        open={rateModalOpen}
        onClose={() => setRateModalOpen(false)}
        title={editingRate ? 'Edit Commission Rate' : 'Add Commission Rate'}
        subtitle="Applies to reconciliations processed after this is saved — already-processed entries keep whatever rate applied at the time"
        footer={
          <>
            <button
              onClick={() => setRateModalOpen(false)}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              form="rate-form"
              type="submit"
              disabled={isSaving || offlineBlocked}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition-all disabled:opacity-60"
            >
              <Plus size={15} />
              {isSaving ? 'Saving…' : editingRate ? 'Save Changes' : 'Add Rate'}
            </button>
          </>
        }
      >
        <form id="rate-form" onSubmit={rateForm.handleSubmit(onSubmitRate)} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">Aging Band</label>
            <select
              disabled={!!editingRate}
              className="w-full px-3 py-2.5 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:opacity-60"
              {...rateForm.register('bucket')}
            >
              {BUCKET_OPTIONS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
            {editingRate && <p className="text-xs text-muted-foreground">The band can&apos;t be changed after it&apos;s created — delete and re-add instead.</p>}
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">Commission Rate (%) <span className="text-negative">*</span></label>
            <input
              type="number"
              step="0.1"
              min="0.1"
              max="100"
              placeholder="e.g. 7"
              className={`w-full px-3 py-2.5 text-sm bg-input border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 ${rateForm.formState.errors.ratePercent ? 'border-negative' : 'border-border'}`}
              {...rateForm.register('ratePercent', {
                required: 'Enter a commission rate',
                validate: (v) => {
                  const n = Number(v);
                  return (Number.isFinite(n) && n > 0 && n <= 100) || 'Enter a percentage between 0 and 100';
                },
              })}
            />
            {rateForm.formState.errors.ratePercent && <p className="text-xs text-negative">{rateForm.formState.errors.ratePercent.message}</p>}
          </div>
        </form>
      </Modal>
    </div>
  );
}
