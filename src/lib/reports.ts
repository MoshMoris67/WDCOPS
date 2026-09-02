import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { getContactedCountsByFile } from './debtor-aggregates';

const NO_CALLS_LABEL = 'No calls yet';

export interface ReportSummary {
  clientName: string;
  totalDebtors: number;
  contacted: number;
  ptpCount: number;
  ptpAmount: number;
  recovered: number;
  totalOwed: number;
  dispositions: { code: string; label: string; count: number }[];
  agentSummary: { agentId: string; name: string; calls: number; ptps: number; recovered: number }[];
  // Used only by the exported workbook (api/reports/export), not the on-screen preview
  // (api/reports/summary) — mirror a client-provided reference format: one row per debtor
  // with their most recent call disposition as "comments", and a tally of those same
  // comments where the total always equals the debtor report's row count (every debtor
  // contributes exactly one comment, "No calls yet" if they have none) — a different
  // question from `dispositions` above, which counts calls logged within the date range.
  commentSummary: { label: string; count: number }[];
  debtorReport: { name: string; phone: string; loanRef: string; balance: number; comment: string }[];
}

export async function buildReportSummary(clientId: string, from: Date, to: Date, agentId?: string): Promise<ReportSummary> {
  const [client, files, dispositionCodes] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id: clientId } }),
    prisma.file.findMany({ where: { clientId }, select: { id: true } }),
    prisma.dispositionCode.findMany(),
  ]);
  const fileIds = files.map((f) => f.id);
  const labelByCode = new Map(dispositionCodes.map((d) => [d.code, d.label]));

  // When agentId is given, every debtor-scoped query below narrows to that agent's *current*
  // book on this client — same "current assignment, not who logged the call historically"
  // convention already used for agent display names below.
  const debtorWhere = agentId ? { fileId: { in: fileIds }, assignedAgentId: agentId } : { fileId: { in: fileIds } };

  const [debtorAgg, contactedCounts, logsInRange, assignedAgentsOnClient, debtorsForReport] = await Promise.all([
    prisma.debtor.aggregate({ where: debtorWhere, _count: { _all: true }, _sum: { amountOwed: true } }),
    // Contacted is date-scoped for a report (calls within the window), unlike team/overview's "ever contacted".
    getContactedCountsByFile(fileIds, { from, to }, agentId),
    prisma.callLog.findMany({
      where: { debtor: debtorWhere, createdAt: { gte: from, lte: to } },
      select: { debtorId: true, agentId: true, dispositionCode: true, promisedAmount: true },
    }),
    // Agent display names come from the debtor's *current* assignedAgent, not callLog.agentId
    // (a reassigned debtor's historical calls are relabeled under the new agent) — a
    // pre-existing quirk, kept intact rather than "fixed" as a side effect of this rewrite.
    prisma.debtor.findMany({
      where: agentId ? { fileId: { in: fileIds }, assignedAgentId: agentId } : { fileId: { in: fileIds }, assignedAgentId: { not: null } },
      select: { id: true, assignedAgentId: true, assignedAgent: { select: { name: true } } },
    }),
    // Raw SQL, not a nested Prisma `include` — tested directly against KCB Mopesa's real
    // 47,928-debtor file first, where the Prisma-relation version (findMany with a nested
    // callLogs orderBy+take:1) reliably crashed the query engine outright ("no entry found
    // for key", a real panic, not a timeout) at that scale, while working fine at take:100.
    // DISTINCT ON is the "latest row per group" pattern used elsewhere in this codebase for
    // similar per-debtor aggregation, just returning full debtor fields instead of a count —
    // 0.3s for the same 47,928 rows in testing, no crash.
    prisma.$queryRaw<{ name: string; phone: string; loanRef: string; balance: number; dispositionCode: string | null }[]>(
      Prisma.sql`
        SELECT DISTINCT ON (d.id) d.name, d.phone1 AS phone, d."loanRef" AS "loanRef", d.balance, cl."dispositionCode" AS "dispositionCode"
        FROM "Debtor" d
        LEFT JOIN "CallLog" cl ON cl."debtorId" = d.id
        WHERE d."fileId" IN (${Prisma.join(fileIds)})
          ${agentId ? Prisma.sql`AND d."assignedAgentId" = ${agentId}` : Prisma.empty}
        ORDER BY d.id, cl."createdAt" DESC NULLS LAST
      `
    ),
  ]);

  const totalDebtors = debtorAgg._count._all;
  const totalOwed = debtorAgg._sum.amountOwed ?? 0;
  const contacted = [...contactedCounts.values()].reduce((s, n) => s + n, 0);

  const agentNameByDebtorId = new Map(assignedAgentsOnClient.map((d) => [d.id, d.assignedAgent?.name ?? 'Unassigned']));
  const agentIdByDebtorId = new Map(assignedAgentsOnClient.map((d) => [d.id, d.assignedAgentId!]));

  const ptpLogs = logsInRange.filter((l) => l.dispositionCode === 'PTP');
  const ptpCount = ptpLogs.length;
  const ptpAmount = ptpLogs.reduce((s, l) => s + (l.promisedAmount ?? 0), 0);

  const recoveredAgg = await prisma.reconciliationEntry.aggregate({
    where: { debtor: debtorWhere, createdAt: { gte: from, lte: to } },
    _sum: { paidAmount: true },
  });

  const dispoCounts = new Map<string, number>();
  for (const log of logsInRange) dispoCounts.set(log.dispositionCode, (dispoCounts.get(log.dispositionCode) ?? 0) + 1);
  const dispositions = [...dispoCounts.entries()]
    .map(([code, count]) => ({ code, label: labelByCode.get(code) ?? code, count }))
    .sort((a, b) => b.count - a.count);

  const debtorReport = debtorsForReport.map((d) => {
    const comment = d.dispositionCode ? (labelByCode.get(d.dispositionCode) ?? d.dispositionCode) : NO_CALLS_LABEL;
    return { name: d.name, phone: d.phone, loanRef: d.loanRef, balance: d.balance, comment };
  });
  const commentCounts = new Map<string, number>();
  for (const d of debtorReport) commentCounts.set(d.comment, (commentCounts.get(d.comment) ?? 0) + 1);
  const commentSummary = [...commentCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  const recoveredByAgentRows = await prisma.reconciliationEntry.groupBy({
    by: ['debtorId'],
    where: {
      debtor: agentId ? { fileId: { in: fileIds }, assignedAgentId: agentId } : { fileId: { in: fileIds }, assignedAgentId: { not: null } },
      createdAt: { gte: from, lte: to },
    },
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
    dispositions,
    agentSummary,
    commentSummary,
    debtorReport,
  };
}
