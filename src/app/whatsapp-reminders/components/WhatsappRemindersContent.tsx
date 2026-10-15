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

interface Overview {
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
  const [overview, setOverview] = useState<Overview | null>(null);
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<SendResult | null>(null);

  const loadOverview = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/whatsapp/reminders${id ? `?fileId=${encodeURIComponent(id)}` : ''}`);
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
  useEffect(() => { loadOverview(fileId); setAttested(false); setLastResult(null); }, [fileId, loadOverview]);
  useEffect(() => { if (authorized === false) router.replace('/agent-dashboard'); }, [authorized, router]);

  async function recordConsent() {
    if (!fileId) return;
    setBusy(true);
    try {
      const res = await fetch('/api/whatsapp/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, optedIn: true }),
      });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error || 'Could not record consent');
      toast.success(`Consent recorded for ${data.updated} debtors`);
      setAttested(false);
      await loadOverview(fileId);
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setBusy(false);
    }
  }

  async function sendBatch() {
    if (!fileId || !overview) return;
    if (!window.confirm(`Send a WhatsApp reminder to up to ${Math.min(overview.stats.eligible, overview.maxPerRequest)} debtors?`)) return;
    setBusy(true);
    try {
      const res = await fetch('/api/whatsapp/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId }),
      });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error || 'Could not send reminders');
      setLastResult(data);
      toast.success(`${data.sent} sent, ${data.failed} failed`);
      await loadOverview(fileId);
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
        <h1 className="text-page-title text-foreground flex items-center gap-2"><MessageCircle size={22} /> WhatsApp reminders</h1>
        <p className="text-sm text-muted-foreground mt-1">Send an approved payment-reminder template to debtors who have agreed to WhatsApp messages.</p>
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

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">{t.label}</p>
              <p className="text-xl font-semibold text-foreground">{t.value ?? '–'}</p>
            </div>
          ))}
        </div>

        {fileId && (
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
              Record consent for this file
            </button>
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={sendBatch}
            disabled={!fileId || !overview?.allowed || !s?.eligible || busy || offlineBlocked}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Send size={15} />
            {busy ? 'Working…' : `Send reminders${s?.eligible ? ` (${Math.min(s.eligible, overview?.maxPerRequest ?? 0)})` : ''}`}
          </button>
          {!fileId && <span className="text-sm text-muted-foreground">Pick a file to send.</span>}
          {fileId && needsConsent && <span className="text-sm text-muted-foreground">Record consent first.</span>}
          {lastResult?.capped && <span className="text-sm text-muted-foreground">More are waiting — send the next batch.</span>}
        </div>
        {lastResult && lastResult.skippedNoNumber > 0 && (
          <p className="text-sm text-muted-foreground">{lastResult.skippedNoNumber} skipped: no usable phone number.</p>
        )}
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
