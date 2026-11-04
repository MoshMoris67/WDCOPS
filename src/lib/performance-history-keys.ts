import { DEPLOYMENT } from '@/config/deployment';

// Month/quarter helpers for performance history — pure, so the History page can use them too.
// Calendar quarters (the fiscal year starts in January); months follow the business time zone.
const OFFSET_MS = DEPLOYMENT.utcOffsetHours * 60 * 60 * 1000;

export function monthKey(d: Date): string {
  const k = new Date(d.getTime() + OFFSET_MS);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function isMonthKey(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function isQuarterKey(s: string): boolean {
  return /^\d{4}-Q[1-4]$/.test(s);
}

/** [start, end) of a business month as UTC instants. */
export function monthBounds(key: string): { start: Date; end: Date } {
  const [y, m] = key.split('-').map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, 1) - OFFSET_MS),
    end: new Date(Date.UTC(y, m, 1) - OFFSET_MS),
  };
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function quarterOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

export function monthsOfQuarter(quarter: string): string[] {
  const [y, q] = quarter.split('-Q').map(Number);
  return [0, 1, 2].map((i) => `${y}-${String((q - 1) * 3 + i + 1).padStart(2, '0')}`);
}

export function shiftQuarter(quarter: string, delta: number): string {
  return quarterOf(shiftMonth(monthsOfQuarter(quarter)[0], delta * 3));
}

