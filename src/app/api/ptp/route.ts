import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getActivePtps, type PtpRow } from '@/lib/ptp';

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

interface Bucket {
  count: number;
  total: number;
  rows: PtpRow[];
}

function bucketOf(rows: PtpRow[]): Bucket {
  return {
    count: rows.length,
    total: rows.reduce((s, r) => s + (r.promisedAmount ?? 0), 0),
    rows,
  };
}

interface BreakdownRow {
  id: string;
  name: string;
  count: number;
  total: number;
}

function breakdownBy(rows: PtpRow[], key: 'agentId' | 'clientId', nameKey: 'agentName' | 'clientName'): BreakdownRow[] {
  const map = new Map<string, BreakdownRow>();
  for (const r of rows) {
    const id = r[key];
    if (!id) continue; // unassigned debtors have no agentId — excluded from the by-agent breakdown
    const name = r[nameKey] ?? 'Unknown';
    const existing = map.get(id);
    if (existing) {
      existing.count += 1;
      existing.total += r.promisedAmount ?? 0;
    } else {
      map.set(id, { id, name, count: 1, total: r.promisedAmount ?? 0 });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

// Agents see only their own active PTPs; admins see the whole branch plus a by-agent
// and by-client breakdown — same scope-by-role pattern as api/debtors. "Active PTP" is
// entirely derived from CallLog (see lib/ptp.ts), so this list is always a live mirror
// of current state: logging any follow-up call on a debtor changes what their latest
// call is, which is what removes (or re-buckets) them here — no separate dismiss action.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const mineOnly = new URL(req.url).searchParams.get('scope') === 'mine' || session.role === 'agent';
  const rows = await getActivePtps(mineOnly ? session.sub : undefined);

  const today = startOfDay(new Date());
  const endToday = endOfDay(new Date());

  const overdueRows: PtpRow[] = [];
  const dueTodayRows: PtpRow[] = [];
  const upcomingRows: PtpRow[] = [];
  for (const r of rows) {
    if (r.promisedDate < today) overdueRows.push(r);
    else if (r.promisedDate <= endToday) dueTodayRows.push(r);
    else upcomingRows.push(r);
  }

  return NextResponse.json({
    overdue: bucketOf(overdueRows),
    dueToday: bucketOf(dueTodayRows),
    upcoming: bucketOf(upcomingRows),
    ...(mineOnly ? {} : {
      byAgent: breakdownBy(rows, 'agentId', 'agentName'),
      byClient: breakdownBy(rows, 'clientId', 'clientName'),
    }),
  });
}
