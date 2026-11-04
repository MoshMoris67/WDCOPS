import { t } from '@/i18n';

export interface Totals {
  recovered: number;
  bookAmount: number;
  recoveryRate: number | null;
  accountsAssigned: number;
  accountsPaid: number;
  paymentCount: number;
  callsMade: number;
  promisesMade: number;
  promisedAmount: number;
  agentCommission: number;
  companyCommission: number;
}
export interface Row extends Totals {
  id: string;
  name: string;
  subtitle?: string;
}
export interface MonthPoint {
  month: string;
  recovered: number;
  recoveryRate: number | null;
  live: boolean;
}
export interface Report {
  period: string;
  kind: 'month' | 'quarter';
  liveMonths: string[];
  emptyMonths: string[];
  totals: Totals;
  previousPeriod: string;
  previousTotals: Totals;
  trend: MonthPoint[];
  months: MonthPoint[];
  files: Row[];
  agents: Row[];
}
export interface FileOption {
  id: string;
  clientId: string;
  batchLabel: string;
}

export const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(1)}%`);

export function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
export function shortMonth(key: string) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
}
export const periodLabel = (p: string) => (p.includes('-Q') ? `${p.split('-Q')[1] ? `Q${p.split('-Q')[1]}` : ''} ${p.split('-Q')[0]}` : monthLabel(p));

export function change(now: number, before: number): { text: string; tone: 'up' | 'down' | 'neutral' } {
  if (before === 0) return { text: now === 0 ? '' : t('new'), tone: now === 0 ? 'neutral' : 'up' };
  const d = ((now - before) / before) * 100;
  return { text: `${d >= 0 ? '+' : ''}${d.toFixed(0)}%`, tone: d > 0.5 ? 'up' : d < -0.5 ? 'down' : 'neutral' };
}


export interface AgentOption {
  id: string;
  name: string;
}

export interface Scope {
  period: string;
  clientId: string;
  fileId: string;
}

export function scopeQuery(scope: Scope, extra: Record<string, string>) {
  const qs = new URLSearchParams({ period: scope.period, ...extra });
  if (scope.clientId) qs.set('clientId', scope.clientId);
  if (scope.fileId) qs.set('fileId', scope.fileId);
  return qs.toString();
}

// Mirrors lib/performance-history.ts AgentReport / CompareReport (JSON from the API).
export interface AgentPoint {
  month: string;
  live: boolean;
  recovered: number;
  recoveryRate: number | null;
  callsMade: number;
  promisesMade: number;
  rank: number | null;
  teamSize: number;
}
export interface AgentReport {
  period: string;
  kind: 'month' | 'quarter';
  agentId: string;
  agentName: string;
  liveMonths: string[];
  totals: Totals;
  previousPeriod: string;
  previousTotals: Totals;
  rankByRecovered: number | null;
  rankByRate: number | null;
  teamSize: number;
  teamAverageRate: number | null;
  trend: AgentPoint[];
  files: Row[];
}
export interface CompareFileRow {
  fileId: string;
  name: string;
  subtitle: string;
  a: Totals | null;
  b: Totals | null;
}
export interface CompareReport {
  period: string;
  kind: 'month' | 'quarter';
  liveMonths: string[];
  a: { id: string; name: string; totals: Totals };
  b: { id: string; name: string; totals: Totals };
  months: { month: string; live: boolean; a: AgentPoint; b: AgentPoint }[];
  files: CompareFileRow[];
  notes: string[];
}
