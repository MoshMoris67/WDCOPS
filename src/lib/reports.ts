import { prisma } from './db';
import { getContactedCountsByFile, getStaleCountsByFile } from './debtor-aggregates';

export interface ReportSummary {
  clientName: string;
  totalDebtors: number;
  contacted: number;
  ptpCount: number;
  ptpAmount: number;
  recovered: number;
  totalOwed: number;
  staleCount: number;
  dispositions: { code: string; label: string; count: number }[];
  agentSummary: { agentId: string; name: string; calls: number; ptps: number; recovered: number }[];
}

export async function buildReportSummary(clientId: string, from: Date, to: Date): Promise<ReportSummary> {
  const [client, files, dispositionCodes] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id: clientId } }),
    prisma.file.findMany({ where: { clientId }, select: { id: true } }),
    prisma.dispositionCode.findMany(),
  ]);
  const fileIds = files.map((f) => f.id);

  const [debtorAgg, contactedCounts, staleCounts, logsInRange, assignedAgentsOnClient] = await Promise.all([
    prisma.debtor.aggregate({ where: { fileId: { in: fileIds } }, _count: { _all: true }, _sum: { amountOwed: true } }),
    // Contacted is date-scoped for a report (calls within the window), unlike team/overview's "ever contacted".
    getContactedCountsByFile(fileIds, { from, to }),
    // Stale = 5+ consecutive NA as of now, regardless of the report's date range (a current-state flag) —
    // same shared definition as team/overview, so the two screens can never disagree on what "stale" means.
    getStaleCountsByFile(fileIds),
    prisma.callLog.findMany({
      where: { debtor: { fileId: { in: fileIds } }, createdAt: { gte: from, lte: to } },
      select: { debtorId: true, agentId: true, dispositionCode: true, promisedAmount: true },
    }),
    // Agent display names come from the debtor's *current* assignedAgent, not callLog.agentId
    // (a reassigned debtor's historical calls are relabeled under the new agent) — a
    // pre-existing quirk, kept intact rather than "fixed" as a side effect of this rewrite.
    prisma.debtor.findMany({
      where: { fileId: { in: fileIds }, assignedAgentId: { not: null } },
      select: { id: true, assignedAgentId: true, assignedAgent: { select: { name: true } } },
    }),
  ]);

  const totalDebtors = debtorAgg._count._all;
  const totalOwed = debtorAgg._sum.amountOwed ?? 0;
  const contacted = [...contactedCounts.values()].reduce((s, n) => s + n, 0);
  const staleCount = [...staleCounts.values()].reduce((s, n) => s + n, 0);

  const agentNameByDebtorId = new Map(assignedAgentsOnClient.map((d) => [d.id, d.assignedAgent?.name ?? 'Unassigned']));
  const agentIdByDebtorId = new Map(assignedAgentsOnClient.map((d) => [d.id, d.assignedAgentId!]));

  const ptpLogs = logsInRange.filter((l) => l.dispositionCode === 'PTP');
  const ptpCount = ptpLogs.length;
  const ptpAmount = ptpLogs.reduce((s, l) => s + (l.promisedAmount ?? 0), 0);

  const recoveredAgg = await prisma.reconciliationEntry.aggregate({
    where: { debtor: { fileId: { in: fileIds } }, createdAt: { gte: from, lte: to } },
    _sum: { paidAmount: true },
  });

  const dispoCounts = new Map<string, number>();
  for (const log of logsInRange) dispoCounts.set(log.dispositionCode, (dispoCounts.get(log.dispositionCode) ?? 0) + 1);
  const labelByCode = new Map(dispositionCodes.map((d) => [d.code, d.label]));
  const dispositions = [...dispoCounts.entries()]
    .map(([code, count]) => ({ code, label: labelByCode.get(code) ?? code, count }))
    .sort((a, b) => b.count - a.count);

  const recoveredByAgentRows = await prisma.reconciliationEntry.groupBy({
    by: ['debtorId'],
    where: { debtor: { fileId: { in: fileIds }, assignedAgentId: { not: null } }, createdAt: { gte: from, lte: to } },
    _sum: { paidAmount: true },
  });
  const recoveredByAgent = new Map<string, number>();
  for (const row of recoveredByAgentRows) {
    const agentId = agentIdByDebtorId.get(row.debtorId);
    if (!agentId) continue;
    recoveredByAgent.set(agentId, (recoveredByAgent.get(agentId) ?? 0) + (row._sum.paidAmount ?? 0));
  }

  const agentStats = new Map<string, { agentId: string; name: string; calls: number; ptps: number }>();
  for (const log of logsInRange) {
    const agentId = log.agentId;
    if (!agentStats.has(agentId)) {
      agentStats.set(agentId, { agentId, name: agentNameByDebtorId.get(log.debtorId) ?? 'Unassigned', calls: 0, ptps: 0 });
    }
    const s = agentStats.get(agentId)!;
    s.calls++;
    if (log.dispositionCode === 'PTP') s.ptps++;
  }
  // Include agents assigned on this client's file even if they logged nothing in range.
  for (const d of assignedAgentsOnClient) {
    if (d.assignedAgentId && !agentStats.has(d.assignedAgentId)) {
      agentStats.set(d.assignedAgentId, { agentId: d.assignedAgentId, name: d.assignedAgent?.name ?? 'Unassigned', calls: 0, ptps: 0 });
    }
  }
  const agentSummary = [...agentStats.values()]
    .map((a) => ({ ...a, recovered: recoveredByAgent.get(a.agentId) ?? 0 }))
    .sort((a, b) => b.calls - a.calls);

  return {
    clientName: client.name,
    totalDebtors,
    contacted,
    ptpCount,
    ptpAmount,
    recovered: recoveredAgg._sum.paidAmount ?? 0,
    totalOwed,
    staleCount,
    dispositions,
    agentSummary,
  };
}
