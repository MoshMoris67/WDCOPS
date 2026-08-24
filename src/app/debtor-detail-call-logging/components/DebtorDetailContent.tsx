'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams, useRouter } from 'next/navigation';
import { Phone, ChevronLeft, ChevronRight, Clock, CheckCircle, MessageSquare, CreditCard, History, User, Calendar, Wifi, WifiOff, Send, Info, X,  } from 'lucide-react';
import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import DispositionBadge from '@/components/ui/DispositionBadge';
import Toggle from '@/components/ui/Toggle';
import { toast } from 'sonner';
import { useOnlineStatus } from '@/lib/use-offline';
import { queueCallLog, syncOneNow, QUEUE_CHANGED_EVENT } from '@/lib/offline-sync';
import { useCachedQuery } from '@/lib/use-cached-query';
import { useCachedDebtorLite } from '@/lib/use-debtor-queue';
import { clientBadgeVariant } from '@/lib/client-badge';

interface CallLogFormData {
  dispositionCode: string;
  note: string;
  promisedAmount: string;
  promisedDate: string;
  callbackDate: string;
  callbackTime: string;
}

interface DispositionCodeOption {
  code: string;
  label: string;
  description: string | null;
  color: string;
  requiresCallback: boolean;
  requiresPtp: boolean;
}

function formatUGX(amount: number) {
  return 'UGX ' + amount.toLocaleString('en-UG');
}

function formatDateTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDateOnly(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB');
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

interface DebtorDetail {
  id: string;
  name: string;
  phone1: string;
  phone2: string | null;
  loanRef: string;
  client: string;
  amountOwed: number;
  cumulativePaid: number;
  balance: number;
  assignedAgent: string | null;
  branch: string;
  naCount: number;
  isStale: boolean;
  isPTP: boolean;
  activePTP: { amount: number; date: string } | null;
}

interface CallHistoryItem {
  id: string;
  disposition: string;
  note: string | null;
  promisedAmount: number | null;
  promisedDate: string | null;
  createdAt: string;
  agentName: string;
  synced: boolean;
}

type TabKey = 'overview' | 'history' | 'payment';

interface DebtorDetailContentProps {
  /** Rendered inline in the desktop split panel instead of as its own full page. */
  embedded?: boolean;
  /** Required when embedded — the standalone page reads the id from the URL instead. */
  debtorId?: string;
  onClose?: () => void;
  /** Desktop split panel supplies these from the queue's live sorted order. */
  onPrev?: () => void;
  onNext?: () => void;
}

export default function DebtorDetailContent({ embedded, debtorId: debtorIdProp, onClose, onPrev, onNext }: DebtorDetailContentProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const debtorId = embedded ? (debtorIdProp ?? null) : searchParams.get('id');
  const formRef = useRef<HTMLFormElement>(null);

  // Standalone mode has no live queue in memory (it's a fresh page navigation), so it
  // reads the ordered id list AgentQueueContent stashes in sessionStorage right
  // before navigating away — same Prev/Next affordance as the embedded split panel,
  // just sourced differently. Absent entirely (a bookmarked/direct link) simply means no
  // Prev/Next controls, not an error.
  const [standaloneQueueIds, setStandaloneQueueIds] = useState<string[] | null>(null);
  useEffect(() => {
    if (embedded) return;
    try {
      const raw = sessionStorage.getItem('queue:my-queue');
      setStandaloneQueueIds(raw ? JSON.parse(raw) : null);
    } catch {
      setStandaloneQueueIds(null);
    }
  }, [embedded]);

  const standaloneIndex = standaloneQueueIds && debtorId ? standaloneQueueIds.indexOf(debtorId) : -1;
  const standalonePrevId = standaloneIndex > 0 ? standaloneQueueIds![standaloneIndex - 1] : null;
  const standaloneNextId = standaloneIndex >= 0 && standaloneIndex < (standaloneQueueIds?.length ?? 0) - 1 ? standaloneQueueIds![standaloneIndex + 1] : null;

  const effectivePrev = onPrev ?? (standalonePrevId ? () => router.push(`/debtor-detail-call-logging?id=${standalonePrevId}`) : undefined);
  const effectiveNext = onNext ?? (standaloneNextId ? () => router.push(`/debtor-detail-call-logging?id=${standaloneNextId}`) : undefined);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target && formRef.current?.contains(target)) return;
      if (e.key === 'ArrowLeft' && effectivePrev) effectivePrev();
      if (e.key === 'ArrowRight' && effectiveNext) effectiveNext();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [effectivePrev, effectiveNext]);

  // Off by default — an agent has to turn this on. Persisted per browser so the
  // choice sticks across debtors and page loads, not just the current session.
  const [autoAdvance, setAutoAdvance] = useState(false);
  useEffect(() => {
    setAutoAdvance(localStorage.getItem('autoAdvance:calls') === 'true');
  }, []);
  function toggleAutoAdvance(next: boolean) {
    setAutoAdvance(next);
    localStorage.setItem('autoAdvance:calls', String(next));
  }

  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isOnline = useOnlineStatus();

  // Full detail (debtor + call history) — cache-backed, so a debtor already opened once
  // on this device renders instantly even offline. `isLoading` only stays true while
  // neither a cached nor a live response has landed yet (a true cold, never-fetched case).
  const detailUrl = debtorId ? `/api/debtors/${debtorId}` : null;
  const {
    data: detailData,
    isLoading: detailLoading,
    error: detailError,
    refetch: refetchDetail,
  } = useCachedQuery<{ debtor: DebtorDetail; callHistory: CallHistoryItem[] }>(detailUrl);
  const debtor = detailData?.debtor ?? null;

  // Fallback when the full detail was never individually fetched on this device but the
  // debtor is (or recently was) in the cached queue list — enough to still log a call.
  const liteRow = useCachedDebtorLite(debtorId);

  const [localLogs, setLocalLogs] = useState<CallHistoryItem[]>([]);
  useEffect(() => {
    setLocalLogs(detailData?.callHistory ?? []);
  }, [detailData]);

  const { data: codesData } = useCachedQuery<{ codes: DispositionCodeOption[] }>('/api/disposition-codes');
  const dispositionCodes = codesData?.codes ?? [];

  const dispositionColor = (code: string) => dispositionCodes.find((d) => d.code === code)?.color ?? '#64748B';

  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm<CallLogFormData>({
    defaultValues: { dispositionCode: '', note: '', promisedAmount: '', promisedDate: '', callbackDate: '', callbackTime: '' },
  });

  const selectedCode = watch('dispositionCode');
  const selectedDispo = dispositionCodes.find(d => d.code === selectedCode);

  useEffect(() => {
    // Fires both when an entry is queued (still offline — nothing to refetch yet) and
    // when the queue successfully drains (back online — refetch to get the real record).
    // Only the latter should trigger a refetch, or we'd immediately re-fail the fetch
    // that just got queued and stomp the optimistic update with an error state.
    const onQueueChanged = () => {
      if (navigator.onLine) refetchDetail();
    };
    window.addEventListener(QUEUE_CHANGED_EVENT, onQueueChanged);
    return () => window.removeEventListener(QUEUE_CHANGED_EVENT, onQueueChanged);
  }, [refetchDetail]);

  // Brief delay so the agent actually sees the "logged" toast before the view jumps —
  // an instant swap reads as the click doing nothing, not as a successful submit.
  function advanceIfEnabled() {
    if (!autoAdvance) return;
    if (!effectiveNext) {
      toast.info("That's the last debtor in your queue");
      return;
    }
    // Safe offline too: the next debtor is already part of the same cached queue this
    // list came from, so it renders from IndexedDB (full detail if it's been opened
    // before, the lite queue-row summary otherwise) rather than needing a network round
    // trip — see use-debtor-queue.ts and the service worker's route-shell fallback.
    setTimeout(() => effectiveNext(), 900);
  }

  async function onSubmit(data: CallLogFormData) {
    if (!data.dispositionCode || !debtorId) {
      toast.error('Select a disposition code before submitting');
      return;
    }
    setIsSubmitting(true);

    const promisedDate = selectedDispo?.requiresPtp
      ? (data.promisedDate || null)
      : selectedDispo?.requiresCallback
        ? (data.callbackDate ? `${data.callbackDate}${data.callbackTime ? `T${data.callbackTime}` : ''}` : null)
        : null;
    const promisedAmount = selectedDispo?.requiresPtp && data.promisedAmount ? Number(data.promisedAmount) : null;

    // Always write locally first, unconditionally — this is what actually makes the
    // disposition durable. `isOnline` (navigator.onLine) only means "some network
    // interface is up"; a request can still hang or fail even while it reads true, and
    // branching the write itself on that flag is how a logged call used to go missing
    // whenever the network was merely flaky rather than cleanly off. The network push
    // below is a separate, best-effort concern — nothing here waits on it to keep the
    // agent's data safe.
    const localId = await queueCallLog({
      debtorId,
      debtorName: debtor?.name ?? liteRow?.name ?? '',
      dispositionCode: data.dispositionCode,
      note: data.note || null,
      promisedAmount,
      promisedDate,
    });
    setLocalLogs((prev) => [
      {
        id: `local-${Date.now()}`,
        disposition: data.dispositionCode,
        note: data.note || null,
        promisedAmount,
        promisedDate,
        createdAt: new Date().toISOString(),
        agentName: 'You',
        synced: false,
      },
      ...prev,
    ]);
    reset();
    setActiveTab('history');
    setIsSubmitting(false);
    advanceIfEnabled();

    // Try to push it right away so an agent who's actually online still sees "synced"
    // instead of always being told "queued" — but this is purely cosmetic. Whether it
    // resolves here or later (AppLayout's periodic flush, or the next 'online' event),
    // the record is already safe on disk.
    const outcome = await syncOneNow(localId);
    if (outcome.ok) {
      toast.success(`Disposition ${data.dispositionCode} logged and synced`);
      refetchDetail();
    } else if (outcome.retryable) {
      toast.warning('Logged — will sync when connected');
    } else {
      toast.error(`Logged locally, but the server rejected it: ${outcome.message}`);
    }
  }

  // Shared between the full detail view and the offline "lite" fallback below — the form
  // itself only ever needed the phone number from the full debtor shape, everything else
  // it touches (dispositionCodes, register, errors, isSubmitting, isOnline, ...) is already
  // in scope regardless of which debtor shape is available.
  function renderLogCallCard(phone: string) {
    return (
      <>
        <div className="px-5 pt-4">
          <a
            href={`tel:${phone}`}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-positive text-white text-sm font-semibold rounded-lg hover:bg-positive/90 active:scale-95 transition-all"
          >
            <Phone size={15} />
            Call {phone}
          </a>
        </div>

        <form ref={formRef} onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-4">
          {/* Disposition code selector */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              Disposition Code <span className="text-negative">*</span>
            </label>
            <p className="text-xs text-muted-foreground">Select the outcome of this call attempt</p>
            <div className={`grid gap-1.5 ${embedded ? 'grid-cols-2 @lg:grid-cols-3' : 'grid-cols-3'}`}>
              {dispositionCodes.map((d) => (
                <label
                  key={`disp-${d.code}`}
                  className={`
                    cursor-pointer flex flex-col items-center justify-center p-2 rounded-lg border-2 transition-all text-center
                    ${selectedCode === d.code
                      ? 'border-primary bg-primary/5' :'border-border hover:border-primary/40 hover:bg-secondary/50'
                    }
                  `}
                  title={d.description ?? undefined}
                >
                  <input
                    type="radio"
                    value={d.code}
                    className="sr-only"
                    {...register('dispositionCode', { required: 'Select a disposition code' })}
                  />
                  <DispositionBadge code={d.code} color={d.color} className="mb-0.5" />
                  <span className="text-xs text-muted-foreground leading-tight mt-0.5">{d.label.split(' ').slice(0, 2).join(' ')}</span>
                </label>
              ))}
            </div>
            {dispositionCodes.length === 0 && (
              <p className="text-xs text-muted-foreground">Loading disposition codes…</p>
            )}
            {errors.dispositionCode && (
              <p className="text-xs text-negative">{errors.dispositionCode.message}</p>
            )}
            {selectedDispo && (
              <div className="flex items-start gap-1.5 mt-1 text-xs text-muted-foreground">
                <Info size={12} className="mt-0.5 shrink-0" />
                <span>{selectedDispo.description}</span>
              </div>
            )}
          </div>

          {/* PTP fields */}
          {selectedDispo?.requiresPtp && (
            <div className="space-y-3 bg-[var(--positive-bg)] border border-[#BBF7D0] rounded-lg p-3 fade-in">
              <p className="text-xs font-semibold text-positive flex items-center gap-1.5">
                <CheckCircle size={13} />
                Promise To Pay Details
              </p>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground">
                  Promised Amount (UGX) <span className="text-negative">*</span>
                </label>
                <input
                  type="number"
                  placeholder="e.g. 400000"
                  className={`w-full px-3 py-2 text-sm bg-white border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 font-tabular ${errors.promisedAmount ? 'border-negative' : 'border-border'}`}
                  {...register('promisedAmount', {
                    required: selectedDispo?.requiresPtp ? 'Enter the promised amount' : false,
                    min: { value: 1, message: 'Amount must be positive' },
                  })}
                />
                {errors.promisedAmount && <p className="text-xs text-negative">{errors.promisedAmount.message}</p>}
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground">
                  Payment Date <span className="text-negative">*</span>
                </label>
                <input
                  type="date"
                  className={`w-full px-3 py-2 text-sm bg-white border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 ${errors.promisedDate ? 'border-negative' : 'border-border'}`}
                  {...register('promisedDate', {
                    required: selectedDispo?.requiresPtp ? 'Select the payment date' : false,
                  })}
                />
                {errors.promisedDate && <p className="text-xs text-negative">{errors.promisedDate.message}</p>}
              </div>
            </div>
          )}

          {/* Callback fields */}
          {selectedDispo?.requiresCallback && (
            <div className="space-y-3 bg-[var(--info-bg)] border border-[#BFDBFE] rounded-lg p-3 fade-in">
              <p className="text-xs font-semibold text-info flex items-center gap-1.5">
                <Calendar size={13} />
                Schedule Callback
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-foreground">Date <span className="text-negative">*</span></label>
                  <input
                    type="date"
                    className="w-full px-2 py-2 text-sm bg-white border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
                    {...register('callbackDate', {
                      required: selectedDispo?.requiresCallback ? 'Select callback date' : false,
                    })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-foreground">Time</label>
                  <input
                    type="time"
                    className="w-full px-2 py-2 text-sm bg-white border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50"
                    {...register('callbackTime')}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              <span className="flex items-center gap-1.5"><MessageSquare size={14} />Call Notes</span>
            </label>
            <p className="text-xs text-muted-foreground">Optional — describe the conversation, debtor attitude, or next steps</p>
            <textarea
              rows={3}
              placeholder="e.g. Debtor was cooperative, mentioned salary comes on 20th…"
              className="w-full px-3 py-2 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 resize-none placeholder:text-muted-foreground"
              {...register('note')}
            />
          </div>

          {/* Offline notice */}
          {!isOnline && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--warning-bg)] border border-[#FDE68A] text-xs text-warning">
              <WifiOff size={12} />
              <span>No connection — log saved locally and will sync on reconnect</span>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100"
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>Logging…</span>
              </>
            ) : (
              <>
                <Send size={15} />
                <span>Log Disposition</span>
              </>
            )}
          </button>
        </form>
      </>
    );
  }

  const backNav = embedded ? (
    <button
      onClick={onClose}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-5"
    >
      <X size={16} />
      Close
    </button>
  ) : (
    <Link
      href="/my-queue"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-5"
    >
      <ChevronLeft size={16} />
      Back to Queue
    </Link>
  );

  if (!debtorId) {
    return (
      <div className={embedded ? '' : 'p-6 xl:p-8 2xl:p-10 max-w-screen-2xl mx-auto'}>
        {backNav}
        <div className="bg-card rounded-xl shadow-card border border-border p-8 text-center">
          <p className="text-sm font-medium text-foreground">No debtor selected — go back to the queue and pick one.</p>
        </div>
      </div>
    );
  }

  if (detailLoading) {
    return (
      <div className={embedded ? '' : 'p-6 xl:p-8 2xl:p-10 max-w-screen-2xl mx-auto'}>
        <p className="text-sm text-muted-foreground">Loading debtor…</p>
      </div>
    );
  }

  if (!debtor) {
    // Full detail was never fetched on this device (and the network attempt above just
    // failed too) — but this debtor is still in the cached queue list, which is enough
    // to let the agent keep working: log a call with what we do have, rather than a dead
    // end. Real profile data (payment history, branch, assigned agent) needs a connection.
    if (liteRow) {
      const recoveryPct = liteRow.amountOwed > 0 ? Math.round(((liteRow.amountOwed - liteRow.balance) / liteRow.amountOwed) * 100) : 0;
      return (
        <div className={embedded ? '' : 'p-6 xl:p-8 2xl:p-10 max-w-screen-2xl mx-auto'}>
          {backNav}
          <div className="flex items-start gap-2 px-3 py-2.5 mb-5 rounded-lg bg-[var(--warning-bg)] border border-[#FDE68A] text-xs text-warning">
            <WifiOff size={14} className="mt-0.5 shrink-0" />
            <span>Full profile unavailable offline — showing last-known summary only. Payment history, branch, and assigned agent need a connection.</span>
          </div>

          <div className="bg-card rounded-xl shadow-card border border-border p-5 mb-6">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-lg font-bold text-primary">{initials(liteRow.name)}</span>
                </div>
                <div>
                  <h1 className="text-xl font-bold text-foreground">{liteRow.name}</h1>
                  <div className="flex items-center gap-3 mt-1 flex-wrap text-sm text-muted-foreground">
                    <a href={`tel:${liteRow.phone}`} className="flex items-center gap-1 hover:text-primary hover:underline">
                      <Phone size={13} />{liteRow.phone}
                    </a>
                    <Badge variant={clientBadgeVariant(liteRow.client)}>{liteRow.client}</Badge>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <div className="text-right">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Balance</p>
                  <p className="font-tabular font-bold text-xl text-negative">{formatUGX(liteRow.balance)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Recovery</p>
                  <p className="font-tabular font-bold text-xl text-foreground">{recoveryPct}%</p>
                </div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-border flex items-center gap-6 flex-wrap text-xs text-muted-foreground">
              <span><span className="font-medium text-foreground">Loan Ref:</span> <span className="font-mono-data">{liteRow.loanRef}</span></span>
              <span><span className="font-medium text-foreground">NA Count:</span> {liteRow.naCount} / 5</span>
            </div>
          </div>

          <div className="bg-card rounded-xl shadow-card border border-border overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">Log a Call</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Select outcome and add notes</p>
            </div>
            {renderLogCallCard(liteRow.phone)}
          </div>
        </div>
      );
    }

    return (
      <div className={embedded ? '' : 'p-6 xl:p-8 2xl:p-10 max-w-screen-2xl mx-auto'}>
        {backNav}
        <div className="bg-card rounded-xl shadow-card border border-border p-8 text-center">
          <p className="text-sm font-medium text-foreground">
            {!isOnline
              ? "Not available offline — this debtor hasn't been opened on this device yet."
              : (detailError || 'Could not load this debtor')}
          </p>
        </div>
      </div>
    );
  }

  const recoveryPct = debtor.amountOwed > 0 ? Math.round(((debtor.amountOwed - debtor.balance) / debtor.amountOwed) * 100) : 0;

  const tabs: { key: TabKey; label: string; icon: typeof User }[] = [
    { key: 'overview', label: 'Overview', icon: User },
    { key: 'history', label: `Call History (${localLogs.length})`, icon: History },
    { key: 'payment', label: 'Payment Summary', icon: CreditCard },
  ];

  return (
    <div className={embedded ? '' : 'p-6 xl:p-8 2xl:p-10 max-w-screen-2xl mx-auto'}>
      {/* Back nav + Prev/Next */}
      <div className="mb-5 flex items-center justify-between gap-3">
        {embedded ? (
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={16} />
            Close
          </button>
        ) : (
          <Link
            href="/my-queue"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft size={16} />
            Back to Queue
          </Link>
        )}
        {(effectivePrev || effectiveNext) && (
          <div className="flex items-center gap-1">
            <button
              onClick={effectivePrev}
              disabled={!effectivePrev}
              title="Previous debtor (←)"
              className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={effectiveNext}
              disabled={!effectiveNext}
              title="Next debtor (→)"
              className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Debtor header card */}
      <div className="bg-card rounded-xl shadow-card border border-border p-5 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-lg font-bold text-primary">{initials(debtor.name)}</span>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-foreground">{debtor.name}</h1>
                {debtor.isStale && (
                  <Badge variant="negative" dot>Stale Account</Badge>
                )}
                {debtor.isPTP && (
                  <Badge variant="positive" dot>Active PTP</Badge>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1 flex-wrap text-sm text-muted-foreground">
                <a href={`tel:${debtor.phone1}`} className="flex items-center gap-1 hover:text-primary hover:underline">
                  <Phone size={13} />{debtor.phone1}
                </a>
                {debtor.phone2 && (
                  <a href={`tel:${debtor.phone2}`} className="flex items-center gap-1 hover:text-primary hover:underline">
                    <Phone size={13} />{debtor.phone2}
                  </a>
                )}
                <Badge variant={clientBadgeVariant(debtor.client)}>{debtor.client}</Badge>
              </div>
            </div>
          </div>

          {/* Key financials */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="text-right">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Balance</p>
              <p className="font-tabular font-bold text-xl text-negative">{formatUGX(debtor.balance)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Paid</p>
              <p className="font-tabular font-bold text-xl text-positive">{formatUGX(debtor.cumulativePaid)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Recovery</p>
              <p className="font-tabular font-bold text-xl text-foreground">{recoveryPct}%</p>
            </div>
          </div>
        </div>

        {/* Metadata row */}
        <div className="mt-4 pt-4 border-t border-border flex items-center gap-6 flex-wrap text-xs text-muted-foreground">
          <span><span className="font-medium text-foreground">Loan Ref:</span> <span className="font-mono-data">{debtor.loanRef}</span></span>
          <span><span className="font-medium text-foreground">Assigned Agent:</span> {debtor.assignedAgent}</span>
          <span><span className="font-medium text-foreground">Branch:</span> {debtor.branch}</span>
          <span><span className="font-medium text-foreground">NA Count:</span> {debtor.naCount} / 5</span>
          {debtor.activePTP && (
            <span className="flex items-center gap-1 text-positive font-medium">
              <CheckCircle size={12} />
              PTP: {formatUGX(debtor.activePTP.amount)} due {formatDateOnly(debtor.activePTP.date)}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            {isOnline
              ? <><Wifi size={12} className="text-positive" /><span className="text-positive">Synced</span></>
              : <><WifiOff size={12} className="text-negative" /><span className="text-negative">Offline</span></>
            }
          </span>
        </div>
      </div>

      {/* embedded uses container queries (the panel's own rendered width) instead of
          viewport breakpoints — a fixed-width side panel can be much narrower than the
          browser viewport, so xl:/2xl: here used to force this 2:1 split (and the
          disposition grid inside it) into far less room than they actually needed,
          reading as cramped. Standalone (a full page) keeps the original viewport-based
          classes, unaffected. */}
      <div className={`grid grid-cols-1 gap-6 ${embedded ? '@4xl:grid-cols-3' : 'xl:grid-cols-3 2xl:grid-cols-3'}`}>
        {/* Left: tabs */}
        <div className={embedded ? '@4xl:col-span-2' : 'xl:col-span-2 2xl:col-span-2'}>
          {/* Tab bar */}
          <div className="flex border-b border-border mb-4 gap-1">
            {tabs.map((tab) => (
              <button
                key={`tab-${tab.key}`}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px ${
                  activeTab === tab.key
                    ? 'border-primary text-primary' :'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <tab.icon size={14} />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Overview tab */}
          {activeTab === 'overview' && (
            <div className="bg-card rounded-xl shadow-card border border-border p-5 fade-in space-y-4">
              <h3 className="text-section-header text-foreground">Debtor Information</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { label: 'Full Name', value: debtor.name },
                  { label: 'Primary Phone', value: debtor.phone1 },
                  { label: 'Secondary Phone', value: debtor.phone2 || '—' },
                  { label: 'Loan Reference', value: debtor.loanRef, mono: true },
                  { label: 'Client', value: debtor.client },
                  { label: 'Branch', value: debtor.branch },
                  { label: 'Amount Owed', value: formatUGX(debtor.amountOwed), tabular: true },
                  { label: 'Cumulative Paid', value: formatUGX(debtor.cumulativePaid), tabular: true },
                  { label: 'Outstanding Balance', value: formatUGX(debtor.balance), tabular: true },
                  { label: 'Recovery Rate', value: `${recoveryPct}%`, tabular: true },
                ].map((field) => (
                  <div key={`field-${field.label}`} className="space-y-0.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{field.label}</p>
                    <p className={`text-sm font-semibold text-foreground ${field.mono ? 'font-mono-data' : ''} ${field.tabular ? 'font-tabular' : ''}`}>
                      {field.value}
                    </p>
                  </div>
                ))}
              </div>

              {debtor.activePTP && (
                <div className="bg-[var(--positive-bg)] border border-[#BBF7D0] rounded-lg p-4 flex items-start gap-3">
                  <CheckCircle size={16} className="text-positive mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-positive">Active Promise To Pay</p>
                    <p className="text-xs text-positive/80 mt-0.5">
                      {formatUGX(debtor.activePTP.amount)} promised on {formatDateOnly(debtor.activePTP.date)}. Follow up if not received.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Call History tab */}
          {activeTab === 'history' && (
            <div className="bg-card rounded-xl shadow-card border border-border fade-in">
              <div className="px-5 py-4 border-b border-border">
                <h3 className="text-section-header text-foreground">Call History</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{localLogs.length} logged interactions — full audit trail</p>
              </div>
              <div className="divide-y divide-border">
                {localLogs.map((log) => (
                  <div key={log.id} className="px-5 py-4 hover:bg-secondary/30 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <DispositionBadge code={log.disposition} color={dispositionColor(log.disposition)} />
                        {!log.synced && (
                          <span className="flex items-center gap-1 text-xs text-warning">
                            <WifiOff size={11} />
                            Pending sync
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground font-mono-data whitespace-nowrap">{formatDateTime(log.createdAt)}</span>
                    </div>
                    {log.note && (
                      <p className="text-sm text-foreground mt-2 leading-relaxed">{log.note}</p>
                    )}
                    {log.disposition === 'PTP' && log.promisedAmount && (
                      <p className="text-xs text-positive mt-1 font-medium">
                        PTP: {formatUGX(log.promisedAmount)} on {formatDateOnly(log.promisedDate)}
                      </p>
                    )}
                    {log.disposition === 'CB' && log.promisedDate && (
                      <p className="text-xs text-info mt-1 font-medium flex items-center gap-1">
                        <Clock size={11} />
                        Callback scheduled: {formatDateTime(log.promisedDate)}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">by {log.agentName}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Payment Summary tab */}
          {activeTab === 'payment' && (
            <div className="bg-card rounded-xl shadow-card border border-border p-5 fade-in space-y-4">
              <h3 className="text-section-header text-foreground">Payment Summary</h3>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Original Debt', value: formatUGX(debtor.amountOwed), color: 'text-foreground' },
                  { label: 'Total Paid', value: formatUGX(debtor.cumulativePaid), color: 'text-positive' },
                  { label: 'Balance Due', value: formatUGX(debtor.balance), color: 'text-negative' },
                ].map((item) => (
                  <div key={`pay-${item.label}`} className="bg-secondary/40 rounded-lg p-4 text-center">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{item.label}</p>
                    <p className={`font-tabular font-bold text-lg ${item.color}`}>{item.value}</p>
                  </div>
                ))}
              </div>

              {/* Recovery progress bar */}
              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Recovery Progress</span>
                  <span className="font-semibold text-foreground">{recoveryPct}%</span>
                </div>
                <div className="h-2.5 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-positive rounded-full transition-all duration-700"
                    style={{ width: `${recoveryPct}%` }}
                  />
                </div>
              </div>

              <div className="bg-secondary/40 rounded-lg p-4">
                <p className="text-sm font-medium text-foreground mb-2">Reconciliation History</p>
                <p className="text-xs text-muted-foreground">No reconciliation updates recorded yet for this debtor. Balances update automatically when the client sends a reconciliation file.</p>
              </div>
            </div>
          )}
        </div>

        {/* Right: Call Logging Form. Its own @container — once the 2:1 split above is
            active, this column is much narrower than the panel as a whole, so the
            disposition grid needs to measure against this column's width, not the outer
            panel's (the nearest @container ancestor otherwise, which would be wide even
            when this column itself is not). */}
        <div className={`@container ${embedded ? '@4xl:col-span-1' : 'xl:col-span-1 2xl:col-span-1'}`}>
          <div className="bg-card rounded-xl shadow-card border border-border sticky top-6">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-section-header text-foreground">Log a Call</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Select outcome and add notes</p>
              </div>
              <div className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full border ${isOnline ? 'sync-online' : 'sync-offline'}`}>
                {isOnline ? <Wifi size={11} /> : <WifiOff size={11} />}
                {isOnline ? 'Online' : 'Offline'}
              </div>
            </div>

            {(effectivePrev || effectiveNext) && (
              <div className="px-5 py-2.5 border-b border-border flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">Auto-advance to next debtor</span>
                <Toggle checked={autoAdvance} onChange={toggleAutoAdvance} size="sm" />
              </div>
            )}

            {renderLogCallCard(debtor.phone1)}
          </div>
        </div>
      </div>
    </div>
  );
}