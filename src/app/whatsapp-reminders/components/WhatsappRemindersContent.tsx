'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageCircle, Send, ShieldCheck } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import { toast } from '@/lib/toast';
import { useOfflineGuard } from '@/lib/use-offline-guard';

interface FileOption {
  id: string;
  client: string;
  batchLabel: string;
  debtorCount: number;
}

interface ClientRow {
  id: string;
  name: string;
  whatsappPayInstruction: string | null;
}

interface Stats {
  total: number;
  withBalance: number;
  optedIn: number;
  optedOut: number;
  eligible: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
}

interface DispositionOption {
  code: string;
  label: string;
}

interface Overview {
  dispositionCounts: Record<string, number>;
  enabled: boolean;
  configured: boolean;
  allowed: boolean;
  reason?: string;
  maxPerRequest: number;
  stats: Stats;
}

interface SendResult {
  sent: number;
  failed: number;
  skippedNoNumber: number;
  considered: number;
  capped: boolean;
}

export default function WhatsappRemindersContent() {
  const router = useRouter();
  const { blocked: offlineBlocked } = useOfflineGuard();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [files, setFiles] = useState<FileOption[]>([]);
  const [fileId, setFileId] = useState('');
  const [dispositionOptions, setDispositionOptions] = useState<DispositionOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<SendResult | null>(null);

  const loadOverview = useCallback(async (id: string, codes: string[]) => {
    try {
      const params = new URLSearchParams();
      if (id) params.set('fileId', id);
      if (codes.length) params.set('dispositions', codes.join(','));
      const res = await fetch(`/api/whatsapp/reminders?${params}`);
      if (res.status === 403) {
        setAuthorized(false);
        return;
      }
      setAuthorized(true);
      setOverview(await res.json());
    } catch {
      toast.error('Could not reach the server — try again');
    }
  }, []);

  useEffect(() => {
    fetch('/api/files')
      .then((r) => (r.ok ? r.json() : { files: [] }))
      .then((d) => setFiles(d.files ?? []))
      .catch(() => undefined);
  }, []);
  const loadClients = useCallback(() => {
    fetch('/api/whatsapp/clients')
      .then((r) => (r.ok ? r.json() : { clients: [] }))
      .then((d) => setClients(d.clients ?? []))
      .catch(() => undefined);
  }, []);
  useEffect(() => { loadClients(); }, [loadClients]);

  async function savePayInstruction(clientId: string, payInstruction: string) {
    try {
      const res = await fetch('/api/whatsapp/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, payInstruction }),
      });
      if (!res.ok) return toast.error((await res.json()).error || 'Could not save');
      toast.success('Saved');
      loadClients();
    } catch {
      toast.error('Could not reach the server — try again');
    }
  }

  useEffect(() => {
    fetch('/api/disposition-codes')
      .then((r) => (r.ok ? r.json() : { codes: [] }))
      .then((d) => setDispositionOptions((d.codes ?? []).map((c: { code: string; label: string }) => ({ code: c.code, label: c.label }))))
      .catch(() => undefined);
  }, []);
  // Changing the file clears the chosen dispositions — they're picked per file, on purpose.
  useEffect(() => { setSelected([]); setAttested(false); setLastResult(null); }, [fileId]);
  useEffect(() => { loadOverview(fileId, selected); setAttested(false); }, [fileId, selected, loadOverview]);

  function toggle(code: string) {
    setSelected((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));
  }
  useEffect(() => { if (authorized === false) router.replace('/agent-dashboard'); }, [authorized, router]);

  async function recordConsent() {
    if (!fileId || !selected.length) return;
    setBusy(true);
    try {
      const res = await fetch('/api/whatsapp/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, dispositions: selected, optedIn: true }),
      });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error || 'Could not record consent');
      toast.success(`Consent recorded for ${data.updated} debtors`);
      setAttested(false);
      await loadOverview(fileId, selected);
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setBusy(false);
    }
  }

  async function sendBatch() {
    if (!fileId || !selected.length || !overview) return;
    if (!window.confirm(`Send a WhatsApp reminder to up to ${Math.min(overview.stats.eligible, overview.maxPerRequest)} debtors?`)) return;
    setBusy(true);
    try {
      const res = await fetch('/api/whatsapp/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, dispositions: selected }),
      });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error || 'Could not send reminders');
      setLastResult(data);
      toast.success(`${data.sent} sent, ${data.failed} failed`);
      await loadOverview(fileId, selected);
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setBusy(false);
    }
  }

  if (authorized === null) {
    return <div className="p-6 xl:p-8 2xl:p-10 max-w-screen-2xl mx-auto"><p className="text-sm text-muted-foreground">Loading…</p></div>;
  }
  if (authorized === false) return null;

  const s = overview?.stats;
  const needsConsent = !!s && s.withBalance > 0 && s.optedIn === 0;
  const tiles: { label: string; value: number | undefined }[] = [
    { label: 'Debtors', value: s?.total },
    { label: 'With a balance', value: s?.withBalance },
    { label: 'Consented', value: s?.optedIn },
    { label: 'Opted out', value: s?.optedOut },
    { label: 'Ready to remind', value: s?.eligible },
  ];
  const delivery: { label: string; value: number | undefined }[] = [
    { label: 'Sent', value: s?.sent },
    { label: 'Delivered', value: s?.delivered },
    { label: 'Read', value: s?.read },
    { label: 'Failed', value: s?.failed },
  ];

  return (
    <div className="p-6 xl:p-8 2xl:p-10 max-w-screen-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-page-title text-foreground flex items-center gap-2"><MessageCircle size={22} /> Reminders</h1>
        <p className="text-sm text-muted-foreground mt-1">Send a WhatsApp payment reminder to debtors in a file who have agreed to receive them. You choose which dispositions to target.</p>
      </div>

      {overview && !overview.allowed && (
        <div className="rounded-xl border border-border bg-card p-4 text-sm flex items-center gap-2">
          <Badge variant="warning">Sending off</Badge>
          <span className="text-muted-foreground">{overview.reason}</span>
        </div>
      )}

      <div className="bg-card rounded-xl shadow-card border border-border p-5 space-y-5">
        <div>
          <label htmlFor="wa-file" className="block text-sm font-medium text-foreground mb-1.5">File</label>
          <select
            id="wa-file"
            value={fileId}
            onChange={(e) => setFileId(e.target.value)}
            className="w-full max-w-md px-3 py-2 text-sm rounded-lg border border-border bg-background"
          >
            <option value="">All files</option>
            {files.map((f) => (
              <option key={f.id} value={f.id}>{f.client} — {f.batchLabel} ({f.debtorCount})</option>
            ))}
          </select>
        </div>

        {fileId && (
          <div>
            <p className="block text-sm font-medium text-foreground mb-1.5">Last disposition to target</p>
            <div className="flex flex-wrap gap-2">
              {[...dispositionOptions, { code: 'NONE', label: 'Never called' }]
                .filter((o) => (overview?.dispositionCounts?.[o.code] ?? 0) > 0)
                .map((o) => {
                  const on = selected.includes(o.code);
                  return (
                    <button
                      key={o.code}
                      type="button"
                      onClick={() => toggle(o.code)}
                      className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${on ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-foreground hover:bg-secondary'}`}
                    >
                      {o.label} ({overview?.dispositionCounts?.[o.code] ?? 0})
                    </button>
                  );
                })}
            </div>
            {!selected.length && <p className="text-xs text-muted-foreground mt-1.5">Choose at least one. The counts below then show only those debtors.</p>}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">{t.label}</p>
              <p className="text-xl font-semibold text-foreground">{t.value ?? '–'}</p>
            </div>
          ))}
        </div>

        {fileId && selected.length > 0 && (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <h2 className="text-section-header text-foreground flex items-center gap-2"><ShieldCheck size={16} /> Consent</h2>
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} className="mt-0.5" />
              <span>I confirm every debtor in this file has agreed to receive WhatsApp messages from us.</span>
            </label>
            <button
              onClick={recordConsent}
              disabled={!attested || busy || offlineBlocked}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Record consent for these debtors
            </button>
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={sendBatch}
            disabled={!fileId || !selected.length || !overview?.allowed || !s?.eligible || busy || offlineBlocked}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Send size={15} />
            {busy ? 'Working…' : `Send reminders${s?.eligible ? ` (${Math.min(s.eligible, overview?.maxPerRequest ?? 0)})` : ''}`}
          </button>
          {!fileId && <span className="text-sm text-muted-foreground">Pick a file to send.</span>}
          {fileId && !selected.length && <span className="text-sm text-muted-foreground">Choose which dispositions to send to.</span>}
          {fileId && needsConsent && <span className="text-sm text-muted-foreground">Record consent first.</span>}
          {lastResult?.capped && <span className="text-sm text-muted-foreground">More are waiting — send the next batch.</span>}
        </div>
        {lastResult && lastResult.skippedNoNumber > 0 && (
          <p className="text-sm text-muted-foreground">{lastResult.skippedNoNumber} skipped: no usable phone number.</p>
        )}
      </div>

      <div className="bg-card rounded-xl shadow-card border border-border p-5 space-y-3">
        <div>
          <h2 className="text-section-header text-foreground">How each client pays</h2>
          <p className="text-xs text-muted-foreground mt-1">Shown at the end of the reminder, for example "Dial *165*45# to pay." A client left blank gets "Please contact us to arrange payment."</p>
        </div>
        {clients.map((c) => (
          <div key={c.id} className="flex items-center gap-3 flex-wrap">
            <label htmlFor={`pay-${c.id}`} className="w-48 text-sm text-foreground">{c.name}</label>
            <input
              id={`pay-${c.id}`}
              defaultValue={c.whatsappPayInstruction ?? ''}
              maxLength={120}
              placeholder="e.g. Dial *165*45# to pay."
              onBlur={(e) => {
                if (e.target.value.trim() !== (c.whatsappPayInstruction ?? '')) savePayInstruction(c.id, e.target.value);
              }}
              className="flex-1 min-w-[16rem] max-w-xl px-3 py-2 text-sm rounded-lg border border-border bg-background"
            />
          </div>
        ))}
      </div>

      <div className="bg-card rounded-xl shadow-card border border-border p-5">
        <h2 className="text-section-header text-foreground mb-3">Delivery</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {delivery.map((d) => (
            <div key={d.label} className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">{d.label}</p>
              <p className="text-xl font-semibold text-foreground">{d.value ?? '–'}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">Delivery and read counts update when WhatsApp reports back through the webhook.</p>
      </div>
    </div>
  );
}
