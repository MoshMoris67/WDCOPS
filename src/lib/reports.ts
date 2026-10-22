import { Prisma } from '@prisma/client';
import { prisma } from './db';
const NO_CALLS_LABEL = 'No calls yet';

export interface ReportSummary {
  clientName: string;
  totalDebtors: number;
  contacted: number;
  ptpCount: number;
  ptpAmount: number;
  recovered: number;
  openingBalance: number;
  closingBalance: number;
  dispositions: { code: string; label: string; count: number }[];
  activityTrend: { date: string; calls: number; collected: number }[];
  contactFunnel: { contactedDebtors: number; ptpDebtors: number };
  promiseFollowThrough: { ptpDebtors: number; paidAfterPtpDebtors: number };
  balanceBands: { band: string; debtors: number; balance: number }[];
  agentSummary: { agentId: string; name: string; calls: number; ptps: number; recovered: number; openingBalance: number }[];
  // Used only by the exported workbook (api/reports/export), not the on-screen preview
  // (api/reports/summary) — mirror a client-provided reference format: one row per debtor
  // with their most recent call disposition as "comments", and a tally of those same
  // comments where the total always equals the debtor report's row count (every debtor
  // contributes exactly one comment, "No calls yet" if they have none) — a different
  // question from `dispositions` above, which counts calls logged within the date range.
  commentSummary: { label: string; count: number }[];
  debtorReport: { name: string; phone: string; loanRef: string; balance: number; comment: string; note: string; callDate: Date | null }[];
}

export async function buildReportSummary(
  clientId: string,
  from: Date,
  to: Date,
  agentId?: string,
  options: { includeDebtorReport?: boolean } = {}
): Promise<ReportSummary> {
  const [client, files, dispositionCodes] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id: clientId } }),
    prisma.file.findMany({ where: { clientId }, select: { id: true } }),
    prisma.dispositionCode.findMany(),
  ]);
  const fileIds = files.map((f) => f.id);
  const labelByCode = new Map(dispositionCodes.map((d) => [d.code, d.label]));
  const rangeDays = Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
  const bucketUnit = rangeDays <= 31 ? 'day' : rangeDays <= 120 ? 'week' : 'month';
  const includeDebtorReport = options.includeDebtorReport ?? false;

  // Debtor lists and call activity retain the existing current-book scope. Recovery
  // percentages use the separate opening-book snapshot so their numerator and denominator
  // describe the same accounts throughout the selected period.
  const debtorWhere = agentId ? { fileId: { in: fileIds }, assignedAgentId: agentId } : { fileId: { in: fileIds } };
  const openingCohortCtes = Prisma.sql`
    WITH target_debtors AS MATERIALIZED (
      SELECT d.id, d."fileId", d."createdAt", d."assignedAgentId", d."amountOwed"
      FROM "Debtor" d
      WHERE d."fileId" IN (${Prisma.join(fileIds)})
        AND d."createdAt" < ${from}
    ),
    past_assignment AS MATERIALIZED (
      SELECT DISTINCT ON (a."debtorId") a."debtorId", a."agentId", a."agentName"
      FROM "Assignment" a
      JOIN target_debtors d ON d.id = a."debtorId"
      WHERE a."assignedAt" < ${from}
      ORDER BY a."debtorId", a."assignedAt" DESC, a.id DESC
    ),
    first_assignment AS MATERIALIZED (
      SELECT DISTINCT ON (a."debtorId") a."debtorId", a."reassignedFromId", a."reassignedFromName"
      FROM "Assignment" a
      JOIN target_debtors d ON d.id = a."debtorId"
      ORDER BY a."debtorId", a."assignedAt", a.id
    ),
    opening_owners AS MATERIALIZED (
      SELECT
        d.id AS "debtorId",
        CASE
          WHEN past."debtorId" IS NOT NULL THEN past."agentId"
          WHEN first."debtorId" IS NOT NULL THEN first."reassignedFromId"
          ELSE d."assignedAgentId"
        END AS "agentId",
        CASE
          WHEN past."debtorId" IS NOT NULL THEN past."agentName"
          WHEN first."debtorId" IS NOT NULL THEN first."reassignedFromName"
          ELSE NULL
        END AS "snapshotName"
      FROM target_debtors d
      LEFT JOIN past_assignment past ON past."debtorId" = d.id
      LEFT JOIN first_assignment first ON first."debtorId" = d.id
    )
  `;

  const [
    debtorAgg,
    logsInRange,
    assignedAgentsOnClient,
    debtorsForReport,
    balanceByAgent,
    recoveryTrendRows,
    promiseFollowThrough,
    balanceBands,
  ] = await Promise.all([
    prisma.debtor.aggregate({ where: debtorWhere, _count: { _all: true } }),
    prisma.callLog.findMany({
      where: { debtor: debtorWhere, createdAt: { gte: from, lte: to } },
      select: {
        debtorId: true,
        createdAt: true,
        agentId: true,
        agentName: true,
        agentEmail: true,
        dispositionCode: true,
        promisedAmount: true,
        debtor: {
          select: {
            assignedAgentId: true,
            assignedAgent: { select: { name: true } },
          },
        },
      },
    }),
    prisma.$queryRaw<{ id: string; name: string | null }[]>(
      Prisma.sql`
        SELECT d."assignedAgentId" AS id, u.name
        FROM "Debtor" d
        LEFT JOIN "User" u ON u.id = d."assignedAgentId"
        WHERE d."fileId" IN (${Prisma.join(fileIds)})
          AND d."assignedAgentId" IS NOT NULL
          ${agentId ? Prisma.sql`AND d."assignedAgentId" = ${agentId}` : Prisma.empty}
        GROUP BY d."assignedAgentId", u.name
      `
    ),
    // Raw SQL, not a nested Prisma `include` — tested directly against KCB Mopesa's real
    // 47,928-debtor file first, where the Prisma-relation version (findMany with a nested
    // callLogs orderBy+take:1) reliably crashed the query engine outright ("no entry found
    // for key", a real panic, not a timeout) at that scale, while working fine at take:100.
    // DISTINCT ON is the "latest row per group" pattern used elsewhere in this codebase for
    // similar per-debtor aggregation, just returning full debtor fields instead of a count —
    // 0.3s for the same 47,928 rows in testing, no crash.
    includeDebtorReport
      ? prisma.$queryRaw<{ name: string; phone: string; loanRef: string; balance: number; dispositionCode: string | null; note: string | null; callDate: Date | null }[]>(
          Prisma.sql`
        SELECT DISTINCT ON (d.id) d.name, d.phone1 AS phone, d."loanRef" AS "loanRef", d.balance,
          cl."dispositionCode" AS "dispositionCode", cl.note, cl."createdAt" AS "callDate"
        FROM "Debtor" d
        LEFT JOIN "CallLog" cl ON cl."debtorId" = d.id
        WHERE d."fileId" IN (${Prisma.join(fileIds)})
          ${agentId ? Prisma.sql`AND d."assignedAgentId" = ${agentId}` : Prisma.empty}
        ORDER BY d.id, cl."createdAt" DESC NULLS LAST
      `
        )
      : Promise.resolve([]),
    prisma.$queryRaw<{ agentId: string | null; agentName: string | null; openingBalance: number; closingBalance: number }[]>(
      Prisma.sql`
          ${openingCohortCtes},
          debtor_balances AS (
            SELECT
              entry."debtorId",
              (ARRAY_AGG(entry."newBalance" ORDER BY COALESCE(entry."paidDate", entry."createdAt") DESC, entry."createdAt" DESC, entry.id DESC)
                FILTER (WHERE COALESCE(entry."paidDate", entry."createdAt") < ${from}))[1] AS opening,
              (ARRAY_AGG(entry."oldBalance" ORDER BY COALESCE(entry."paidDate", entry."createdAt"), entry."createdAt", entry.id)
                FILTER (WHERE COALESCE(entry."paidDate", entry."createdAt") >= ${from}
                  AND COALESCE(entry."paidDate", entry."createdAt") <= ${to}))[1] AS period_start,
              (ARRAY_AGG(entry."newBalance" ORDER BY COALESCE(entry."paidDate", entry."createdAt") DESC, entry."createdAt" DESC, entry.id DESC)
                FILTER (WHERE COALESCE(entry."paidDate", entry."createdAt") <= ${to}))[1] AS closing
            FROM "ReconciliationEntry" entry
            JOIN target_debtors d ON d.id = entry."debtorId"
            WHERE COALESCE(entry."paidDate", entry."createdAt") <= ${to}
            GROUP BY entry."debtorId"
          )
          SELECT
            owner."agentId" AS "agentId",
            COALESCE(u.name, MAX(owner."snapshotName")) AS "agentName",
            SUM(COALESCE(b.opening, b.period_start, d."amountOwed")) AS "openingBalance",
            SUM(COALESCE(b.closing, b.opening, b.period_start, d."amountOwed")) AS "closingBalance"
          FROM target_debtors d
          JOIN opening_owners owner ON owner."debtorId" = d.id
          LEFT JOIN debtor_balances b ON b."debtorId" = d.id
          LEFT JOIN "User" u ON u.id = owner."agentId"
          WHERE true
            ${agentId ? Prisma.sql`AND owner."agentId" = ${agentId}` : Prisma.empty}
          GROUP BY owner."agentId", u.name
      `
    ),
    prisma.$queryRaw<{ agentId: string | null; agentName: string | null; bucketStart: Date; recovered: number }[]>(
      Prisma.sql`
        ${openingCohortCtes}
        SELECT
          owner."agentId" AS "agentId",
          COALESCE(u.name, MAX(owner."snapshotName")) AS "agentName",
          date_trunc(${bucketUnit}, COALESCE(entry."paidDate", entry."createdAt")) AS "bucketStart",
          SUM(entry."paidAmount") AS "recovered"
        FROM "ReconciliationEntry" entry
        JOIN target_debtors d ON d.id = entry."debtorId"
        JOIN opening_owners owner ON owner."debtorId" = d.id
        LEFT JOIN "User" u ON u.id = owner."agentId"
        WHERE COALESCE(entry."paidDate", entry."createdAt") >= ${from}
          AND COALESCE(entry."paidDate", entry."createdAt") <= ${to}
          ${agentId ? Prisma.sql`AND owner."agentId" = ${agentId}` : Prisma.empty}
        GROUP BY owner."agentId", u.name, date_trunc(${bucketUnit}, COALESCE(entry."paidDate", entry."createdAt"))
        ORDER BY "bucketStart"
      `
    ),
    prisma.$queryRaw<{ ptpDebtors: number; paidAfterPtpDebtors: number }[]>(
      Prisma.sql`
        WITH ptp_accounts AS (
          SELECT d.id AS "debtorId", MIN(cl."createdAt") AS "firstPtpAt"
          FROM "CallLog" cl
          JOIN "Debtor" d ON d.id = cl."debtorId"
          WHERE cl."dispositionCode" = 'PTP'
            AND cl."createdAt" >= ${from}
            AND cl."createdAt" <= ${to}
            AND d."fileId" IN (${Prisma.join(fileIds)})
            ${agentId ? Prisma.sql`AND d."assignedAgentId" = ${agentId}` : Prisma.empty}
          GROUP BY d.id
        ),
        paid_after_ptp AS (
          SELECT p."debtorId"
          FROM ptp_accounts p
          JOIN "ReconciliationEntry" entry ON entry."debtorId" = p."debtorId"
          WHERE entry."createdAt" >= p."firstPtpAt"
            AND entry."createdAt" <= ${to}
            AND entry."paidAmount" > 0
          GROUP BY p."debtorId"
        )
        SELECT
          (SELECT COUNT(*)::int FROM ptp_accounts) AS "ptpDebtors",
          (SELECT COUNT(*)::int FROM paid_after_ptp) AS "paidAfterPtpDebtors"
      `
    ),
    prisma.$queryRaw<{ band: string; debtors: number; balance: number }[]>(
      Prisma.sql`
        WITH ranked AS (
          SELECT d.balance, NTILE(3) OVER (ORDER BY d.balance ASC, d.id) AS band_number
          FROM "Debtor" d
          WHERE d."fileId" IN (${Prisma.join(fileIds)})
            ${agentId ? Prisma.sql`AND d."assignedAgentId" = ${agentId}` : Prisma.empty}
        )
        SELECT
          CASE band_number
            WHEN 1 THEN 'Lower balances'
            WHEN 2 THEN 'Middle balances'
            ELSE 'Higher balances'
          END AS band,
          COUNT(*)::int AS debtors,
          SUM(balance) AS balance
        FROM ranked
        GROUP BY band_number
        ORDER BY band_number
      `
    ),
  ]);

  const totalDebtors = debtorAgg._count._all;
  const contacted = new Set(logsInRange.map((log) => log.debtorId)).size;

  const agentNameById = new Map(assignedAgentsOnClient.map((agent) => [agent.id, agent.name ?? 'Unknown']));

  const ptpLogs = logsInRange.filter((l) => l.dispositionCode === 'PTP');
  const ptpCount = ptpLogs.length;
  const ptpAmount = ptpLogs.reduce((s, l) => s + (l.promisedAmount ?? 0), 0);
  const ptpDebtors = new Set(ptpLogs.map((log) => log.debtorId));

  const trendByDate = new Map<string, { date: string; calls: number; collected: number }>();
  const bucketDate = (value: Date) => {
    const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
    if (bucketUnit === 'week') {
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    } else if (bucketUnit === 'month') {
      date.setUTCDate(1);
    }
    return date.toISOString().slice(0, 10);
  };
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  if (bucketUnit === 'week') cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7));
  if (bucketUnit === 'month') cursor.setUTCDate(1);
  const lastBucketDate = bucketDate(to);
  while (cursor.toISOString().slice(0, 10) <= lastBucketDate) {
    const date = cursor.toISOString().slice(0, 10);
    trendByDate.set(date, { date, calls: 0, collected: 0 });
    if (bucketUnit === 'day') cursor.setUTCDate(cursor.getUTCDate() + 1);
    else if (bucketUnit === 'week') cursor.setUTCDate(cursor.getUTCDate() + 7);
    else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  for (const log of logsInRange) {
    const date = bucketDate(log.createdAt);
    const row = trendByDate.get(date) ?? { date, calls: 0, collected: 0 };
    row.calls++;
    trendByDate.set(date, row);
  }
  for (const row of recoveryTrendRows) {
    const date = bucketDate(row.bucketStart);
    const trend = trendByDate.get(date) ?? { date, calls: 0, collected: 0 };
    trend.collected += row.recovered;
    trendByDate.set(date, trend);
  }

  const openingBalance = balanceByAgent.reduce((sum, row) => sum + row.openingBalance, 0);
  const closingBalance = balanceByAgent.reduce((sum, row) => sum + row.closingBalance, 0);

  const dispoCounts = new Map<string, number>();
  for (const log of logsInRange) dispoCounts.set(log.dispositionCode, (dispoCounts.get(log.dispositionCode) ?? 0) + 1);
  const dispositions = [...dispoCounts.entries()]
    .map(([code, count]) => ({ code, label: labelByCode.get(code) ?? code, count }))
    .sort((a, b) => b.count - a.count);

  const debtorReport = debtorsForReport.map((d) => {
    const comment = d.dispositionCode ? (labelByCode.get(d.dispositionCode) ?? d.dispositionCode) : NO_CALLS_LABEL;
    return { name: d.name, phone: d.phone, loanRef: d.loanRef, balance: d.balance, comment, note: d.note ?? '', callDate: d.callDate };
  });
  const commentCounts = new Map<string, number>();
  for (const d of debtorReport) commentCounts.set(d.comment, (commentCounts.get(d.comment) ?? 0) + 1);
  const commentSummary = [...commentCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  const recoveredByAgent = new Map<string, number>();
  const nameByHistoricalAgentId = new Map<string, string>();
  for (const row of recoveryTrendRows) {
    if (!row.agentId) continue;
    recoveredByAgent.set(row.agentId, (recoveredByAgent.get(row.agentId) ?? 0) + row.recovered);
    if (row.agentName) nameByHistoricalAgentId.set(row.agentId, row.agentName);
  }

  const openingByAgent = new Map<string, { agentId: string; name: string; openingBalance: number }>();
  for (const row of balanceByAgent) {
    if (!row.agentId) continue;
    openingByAgent.set(row.agentId, {
      agentId: row.agentId,
      name: row.agentName ?? 'Unknown',
      openingBalance: row.openingBalance,
    });
  }

  const agentStats = new Map<string, { agentId: string; name: string; calls: number; ptps: number }>();
  for (const log of logsInRange) {
    const currentAgentId = log.debtor.assignedAgentId;
    const agentId = currentAgentId ?? log.agentId ?? `deleted:${log.agentEmail}`;
    let name = log.agentName;
    if (currentAgentId) name = log.debtor.assignedAgent?.name ?? name;
    else if (log.agentId) name = 'Unassigned';
    if (!agentStats.has(agentId)) {
      agentStats.set(agentId, { agentId, name, calls: 0, ptps: 0 });
    }
    const s = agentStats.get(agentId)!;
    s.calls++;
    if (log.dispositionCode === 'PTP') s.ptps++;
  }
  // Include agents assigned on this client's file even if they logged nothing in range.
  for (const agent of assignedAgentsOnClient) {
    if (agent.id && !agentStats.has(agent.id)) {
      agentStats.set(agent.id, { agentId: agent.id, name: agent.name ?? 'Unknown', calls: 0, ptps: 0 });
    }
  }
  for (const agent of openingByAgent.values()) {
    if (!agentStats.has(agent.agentId)) {
      agentStats.set(agent.agentId, { agentId: agent.agentId, name: agent.name, calls: 0, ptps: 0 });
    }
  }
  const agentSummary = [...agentStats.values()]
    .map((a) => ({
      ...a,
      recovered: recoveredByAgent.get(a.agentId) ?? 0,
      openingBalance: openingByAgent.get(a.agentId)?.openingBalance ?? 0,
      name: openingByAgent.get(a.agentId)?.name ?? nameByHistoricalAgentId.get(a.agentId) ?? a.name,
    }))
    .sort((a, b) => b.calls - a.calls);

  return {
    clientName: client.name,
    totalDebtors,
    contacted,
    ptpCount,
    ptpAmount,
    recovered: recoveryTrendRows.reduce((sum, row) => sum + row.recovered, 0),
    openingBalance,
    closingBalance,
    dispositions,
    activityTrend: [...trendByDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    contactFunnel: { contactedDebtors: contacted, ptpDebtors: ptpDebtors.size },
    promiseFollowThrough: promiseFollowThrough[0] ?? { ptpDebtors: 0, paidAfterPtpDebtors: 0 },
    balanceBands,
    agentSummary,
    commentSummary,
    debtorReport,
  };
}
