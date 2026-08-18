import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { getLastCallNonNaCount } from '@/lib/debtor-aggregates';

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Local calendar date as YYYY-MM-DD — not toISOString(), which converts to UTC and
// silently shifts the date backward for any timezone ahead of UTC (e.g. Uganda's EAT).
function formatLocalDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  // Same "mine" override as /api/debtors — an admin looking at their own My Queue
  // dashboard wants their own numbers, not the whole branch's.
  const mineOnly = new URL(req.url).searchParams.get('scope') === 'mine';
  const debtorWhere = session.role === 'agent' || mineOnly ? { assignedAgentId: session.sub } : {};
  const today = startOfDay(new Date());
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

  const agentFilter = session.role === 'agent' || mineOnly ? session.sub : undefined;

  const [totalAssigned, contacted] = await Promise.all([
    prisma.debtor.count({ where: debtorWhere }),
    getLastCallNonNaCount(agentFilter),
  ]);
  const contactRate = totalAssigned > 0 ? Math.round((contacted / totalAssigned) * 100) : 0;

  const callLogWhere = session.role === 'agent' || mineOnly ? { agentId: session.sub } : {};

  const [callsToday, dispoBreakdownRows] = await Promise.all([
    prisma.callLog.count({ where: { ...callLogWhere, createdAt: { gte: today } } }),
    prisma.callLog.groupBy({ by: ['dispositionCode'], where: { ...callLogWhere, createdAt: { gte: today } }, _count: { _all: true } }),
  ]);
  const dispositionBreakdownToday = dispoBreakdownRows.map((r) => ({ code: r.dispositionCode, count: r._count._all }));

  const trendLogs = await prisma.callLog.findMany({
    where: { ...callLogWhere, createdAt: { gte: sevenDaysAgo } },
    select: { createdAt: true },
  });
  const dailyTrend: { date: string; count: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const dayStart = new Date(sevenDaysAgo);
    dayStart.setDate(dayStart.getDate() + i);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const count = trendLogs.filter((l) => l.createdAt >= dayStart && l.createdAt < dayEnd).length;
    dailyTrend.push({ date: formatLocalDate(dayStart), count });
  }

  return NextResponse.json({ callsToday, contactRate, dispositionBreakdownToday, dailyTrend });
}
