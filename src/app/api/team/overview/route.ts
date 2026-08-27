import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { getFileDebtorAggregates, getContactedCountsByFile } from '@/lib/debtor-aggregates';

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export async function GET() {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const today = startOfDay(new Date());

  const [clients, files, agents] = await Promise.all([
    prisma.client.findMany(),
    prisma.file.findMany({ select: { id: true, clientId: true, receivedDate: true, batchLabel: true } }),
    prisma.user.findMany({
      where: { role: { in: ['agent', 'admin'] } },
      select: { id: true, name: true, role: true, status: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const fileIds = files.map((f) => f.id);
  const filesByClient = new Map<string, typeof files>();
  for (const f of files) {
    if (!filesByClient.has(f.clientId)) filesByClient.set(f.clientId, []);
    filesByClient.get(f.clientId)!.push(f);
  }

  const agentIds = agents.map((a) => a.id);

  const [aggregates, contactedByFile, assignedCounts, callStatsToday] = await Promise.all([
    getFileDebtorAggregates(fileIds),
    getContactedCountsByFile(fileIds),
    prisma.debtor.groupBy({ by: ['assignedAgentId'], where: { assignedAgentId: { in: agentIds } }, _count: { _all: true } }),
    prisma.callLog.groupBy({ by: ['agentId', 'dispositionCode'], where: { agentId: { in: agentIds }, createdAt: { gte: today } }, _count: { _all: true } }),
  ]);

  // Admins only show up here once they're actually taking calls on something — otherwise
  // every admin account would clutter this list with permanent 0s.
  const assignedCountByAgent = new Map(assignedCounts.map((r) => [r.assignedAgentId as string, r._count._all]));
  const participatingAgents = agents.filter((a) => a.role === 'agent' || (assignedCountByAgent.get(a.id) ?? 0) > 0);

  const clientSummaries = clients.map((c) => {
    const clientFileIds = (filesByClient.get(c.id) ?? []).map((f) => f.id);
    let debtorCount = 0, recovered = 0, totalOwed = 0, totalBalance = 0, contacted = 0;
    for (const fid of clientFileIds) {
      const agg = aggregates.get(fid);
      if (agg) {
        debtorCount += agg.debtorCount;
        recovered += agg.recovered;
        totalOwed += agg.totalOwed;
        totalBalance += agg.totalBalance;
      }
      contacted += contactedByFile.get(fid) ?? 0;
    }
    const contactRate = debtorCount > 0 ? Math.round((contacted / debtorCount) * 100) : 0;
    // Already fetched above for the aggregation rollup — trimming to the 3 most recent
    // is free, not a new query.
    const recentFiles = (filesByClient.get(c.id) ?? [])
      .slice()
      .sort((a, b) => b.receivedDate.getTime() - a.receivedDate.getTime())
      .slice(0, 3)
      .map((f) => ({ id: f.id, batchLabel: f.batchLabel, receivedDate: f.receivedDate }));
    // totalOwed is the original disbursed amount (used for the recovery-% base below);
    // totalBalance is the current outstanding book value — genuinely different numbers,
    // both surfaced since ClientCard shows book value alongside recovery progress.
    return { id: c.id, name: c.name, reconciliationType: c.reconciliationType, debtorCount, contactRate, recovered, totalOwed, totalBalance, recentFiles };
  });

  const agentSummaries = participatingAgents.map((a) => {
    const rows = callStatsToday.filter((r) => r.agentId === a.id);
    const callsToday = rows.reduce((s, r) => s + r._count._all, 0);
    const ptpsToday = rows.find((r) => r.dispositionCode === 'PTP')?._count._all ?? 0;
    return {
      id: a.id,
      name: a.name,
      role: a.role,
      status: a.status,
      assignedCount: assignedCountByAgent.get(a.id) ?? 0,
      callsToday,
      ptpsToday,
    };
  });

  return NextResponse.json({ clients: clientSummaries, agents: agentSummaries });
}
