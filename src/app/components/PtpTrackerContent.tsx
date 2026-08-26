'use client';

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, Clock, CalendarClock, Phone } from 'lucide-react';
import KPICard from './KPICard';
import Badge from '@/components/ui/Badge';
import { useCachedQuery } from '@/lib/use-cached-query';
import { clientBadgeVariant } from '@/lib/client-badge';
import { toDialFormat } from '@/lib/phone';

interface PtpRow {
  id: string;
  name: string;
  phone: string;
  clientId: string;
  clientName: string;
  agentId: string | null;
  agentName: string | null;
  promisedAmount: number | null;
  promisedDate: string;
}

interface Bucket {
  count: number;
  total: number;
  rows: PtpRow[];
}

interface BreakdownRow {
  id: string;
  name: string;
  count: number;
  total: number;
}

interface PtpResponse {
  overdue: Bucket;
  dueToday: Bucket;
  upcoming: Bucket;
  byAgent?: BreakdownRow[];
  byClient?: BreakdownRow[];
}

function formatUGX(amount: number) {
  if (amount >= 1000000) return `UGX ${(amount / 1000000).toFixed(1)}M`;
  return 'UGX ' + amount.toLocaleString('en-UG');
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function PtpSection({ title, icon: Icon, tone, bucket, showAgent }: {
  title: string;
  icon: typeof Clock;
  tone: 'negative' | 'warning' | 'info';
  bucket: Bucket;
  showAgent: boolean;
}) {
  return (
    <div className="bg-card rounded-xl shadow-card border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <Icon size={16} className={tone === 'negative' ? 'text-negative' : tone === 'warning' ? 'text-warning' : 'text-info'} />
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <span className="text-xs text-muted-foreground ml-1">({bucket.count})</span>
      </div>
      {bucket.rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground text-center">Nothing here.</p>
      ) : (
        <div className="divide-y divide-border max-h-96 overflow-y-auto scrollbar-thin">
          {bucket.rows.map((r) => (
            <Link
              key={r.id}
              href={`/debtor-detail-call-logging?id=${r.id}`}
              className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-secondary/40 transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <Badge variant={clientBadgeVariant(r.clientName)}>{r.clientName}</Badge>
                  {showAgent && r.agentName && <span className="text-xs text-muted-foreground">{r.agentName}</span>}
                  <span className="text-xs text-muted-foreground">{formatDate(r.promisedDate)}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="font-tabular text-sm font-semibold text-foreground">{formatUGX(r.promisedAmount ?? 0)}</span>
                <a
                  href={`tel:${toDialFormat(r.phone)}`}
                  onClick={(e) => e.stopPropagation()}
                  className="p-1.5 rounded-md hover:bg-primary/10 hover:text-primary transition-colors text-muted-foreground"
                  title="Call this debtor"
                >
                  <Phone size={15} />
                </a>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  return (
    <div className="bg-card rounded-xl shadow-card border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <p className="text-sm font-semibold text-foreground">{title}</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground text-center">No active PTPs.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2.5 text-foreground">{r.name}</td>
                <td className="px-4 py-2.5 text-muted-foreground text-right">{r.count} PTP{r.count === 1 ? '' : 's'}</td>
                <td className="px-4 py-2.5 font-tabular font-semibold text-foreground text-right">{formatUGX(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function PtpTrackerContent() {
  const { data, isLoading } = useCachedQuery<PtpResponse>('/api/ptp');
  const isAdmin = data?.byAgent !== undefined;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">Promises to Pay</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {isAdmin ? 'Every active PTP across the branch.' : 'Your active promises to pay.'}
        </p>
      </div>

      {isLoading && !data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <KPICard label="Overdue" value={data.overdue.count} subtext={formatUGX(data.overdue.total)} icon={AlertTriangle} variant="negative" />
            <KPICard label="Due Today" value={data.dueToday.count} subtext={formatUGX(data.dueToday.total)} icon={Clock} variant="warning" />
            <KPICard label="Upcoming" value={data.upcoming.count} subtext={formatUGX(data.upcoming.total)} icon={CalendarClock} variant="info" />
          </div>

          <div className="space-y-4">
            <PtpSection title="Overdue" icon={AlertTriangle} tone="negative" bucket={data.overdue} showAgent={isAdmin} />
            <PtpSection title="Due Today" icon={Clock} tone="warning" bucket={data.dueToday} showAgent={isAdmin} />
            <PtpSection title="Upcoming" icon={CalendarClock} tone="info" bucket={data.upcoming} showAgent={isAdmin} />
          </div>

          {isAdmin && data.byAgent && data.byClient && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
              <BreakdownTable title="By Agent" rows={data.byAgent} />
              <BreakdownTable title="By Client" rows={data.byClient} />
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Couldn&apos;t load PTPs.</p>
      )}
    </div>
  );
}
