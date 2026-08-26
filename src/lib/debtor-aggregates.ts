import { Prisma } from '@prisma/client';
import { prisma } from './db';

export interface FileDebtorAggregate {
  debtorCount: number;
  assignedCount: number;
  totalBalance: number;
  recovered: number;
  totalOwed: number;
}

// DB-side aggregation for a set of files' debtors — never loads a full Debtor row per
// call the way the routes this replaces used to (85,000+ rows across the branch).
export async function getFileDebtorAggregates(fileIds: string[]): Promise<Map<string, FileDebtorAggregate>> {
  const result = new Map<string, FileDebtorAggregate>();
  if (fileIds.length === 0) return result;

  const rows = await prisma.debtor.groupBy({
    by: ['fileId'],
    where: { fileId: { in: fileIds } },
    _count: { _all: true, assignedAgentId: true },
    _sum: { balance: true, cumulativePaid: true, amountOwed: true },
  });

  for (const r of rows) {
    result.set(r.fileId, {
      debtorCount: r._count._all,
      assignedCount: r._count.assignedAgentId,
      totalBalance: r._sum.balance ?? 0,
      recovered: r._sum.cumulativePaid ?? 0,
      totalOwed: r._sum.amountOwed ?? 0,
    });
  }
  return result;
}

// Distinct agents actually holding a debtor, per file — bounded by files × agents
// (dozens/hundreds of rows), not by debtor count.
export async function getAgentsAllocatedCounts(fileIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (fileIds.length === 0) return result;

  const rows = await prisma.debtor.groupBy({
    by: ['fileId', 'assignedAgentId'],
    where: { fileId: { in: fileIds }, assignedAgentId: { not: null } },
  });

  for (const r of rows) {
    result.set(r.fileId, (result.get(r.fileId) ?? 0) + 1);
  }
  return result;
}

export interface FileAgentAggregate {
  fileId: string;
  agentId: string;
  assignedCount: number;
  recovered: number;
}

// Recovered amount per (file, agent) pair — same groupBy shape as getAgentsAllocatedCounts,
// with a sum added. Backs both an agent's own "how much of this file's collections came
// from me" view and the admin's file-by-agent performance breakdown.
export async function getFileAgentRecoveredAggregates(fileIds: string[]): Promise<FileAgentAggregate[]> {
  if (fileIds.length === 0) return [];

  const rows = await prisma.debtor.groupBy({
    by: ['fileId', 'assignedAgentId'],
    where: { fileId: { in: fileIds }, assignedAgentId: { not: null } },
    _count: { _all: true },
    _sum: { cumulativePaid: true },
  });

  return rows.map((r) => ({
    fileId: r.fileId,
    agentId: r.assignedAgentId as string,
    assignedCount: r._count._all,
    recovered: r._sum.cumulativePaid ?? 0,
  }));
}

interface DateRange {
  from: Date;
  to: Date;
}

// "Contacted" = has at least one call log, optionally scoped to a date range. Without a
// range this answers "ever contacted" (team/overview); with one it answers "contacted
// within this report window" (reports.ts) — genuinely different questions, same shape.
export async function getContactedCountsByFile(fileIds: string[], range?: DateRange): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (fileIds.length === 0) return result;

  const rows = range
    ? await prisma.$queryRaw<{ fileId: string; count: number }[]>`
        SELECT d."fileId" AS "fileId", COUNT(DISTINCT cl."debtorId") AS "count"
        FROM "CallLog" cl JOIN "Debtor" d ON d.id = cl."debtorId"
        WHERE d."fileId" IN (${Prisma.join(fileIds)})
          AND cl."createdAt" >= ${range.from} AND cl."createdAt" <= ${range.to}
        GROUP BY d."fileId"
      `
    : await prisma.$queryRaw<{ fileId: string; count: number }[]>`
        SELECT d."fileId" AS "fileId", COUNT(DISTINCT cl."debtorId") AS "count"
        FROM "CallLog" cl JOIN "Debtor" d ON d.id = cl."debtorId"
        WHERE d."fileId" IN (${Prisma.join(fileIds)})
        GROUP BY d."fileId"
      `;

  for (const r of rows) result.set(r.fileId, Number(r.count));
  return result;
}

// A debtor is stale when it has 5+ call logs AND the 5 most-recent are all dispositionCode
// 'NA' — matches src/lib/debtor-status.ts's computeDebtorStatus (naCount >= 5) exactly:
// that function walks call logs newest-first and stops counting at the first non-NA row,
// so naCount can only reach 5 if the top 5 rows are all NA. rn<=5 + COUNT(*)=5 requires the
// debtor to actually have 5 logs (the window isn't padded); SUM(non-NA)=0 requires all 5 to
// be NA. Same condition, computed at the database instead of per-debtor in Node.
export async function getStaleCountsByFile(fileIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (fileIds.length === 0) return result;

  const rows = await prisma.$queryRaw<{ fileId: string; count: number }[]>`
    WITH ranked AS (
      SELECT cl."debtorId" AS "debtorId",
             cl."dispositionCode" AS "dispositionCode",
             ROW_NUMBER() OVER (PARTITION BY cl."debtorId" ORDER BY cl."createdAt" DESC) AS rn
      FROM "CallLog" cl
      WHERE cl."debtorId" IN (SELECT id FROM "Debtor" WHERE "fileId" IN (${Prisma.join(fileIds)}))
    ),
    stale_debtors AS (
      SELECT "debtorId" FROM ranked
      WHERE rn <= 5
      GROUP BY "debtorId"
      HAVING COUNT(*) = 5 AND SUM(CASE WHEN "dispositionCode" != 'NA' THEN 1 ELSE 0 END) = 0
    )
    SELECT d."fileId" AS "fileId", COUNT(*) AS "count"
    FROM stale_debtors sd JOIN "Debtor" d ON d.id = sd."debtorId"
    GROUP BY d."fileId"
  `;

  for (const r of rows) result.set(r.fileId, Number(r.count));
  return result;
}

export interface CallLogLite {
  dispositionCode: string;
  createdAt: Date;
  promisedAmount: number | null;
  promisedDate: Date | null;
}

// The debtor-status.ts inputs a queue needs (dispositionCode/createdAt/promisedAmount/
// promisedDate for the 5 most recent calls), for many debtors in one query instead of
// Prisma's per-parent-row relation fetch (`debtor.findMany({ include: { callLogs: {
// take: 5 } } })`) — fine at normal queue sizes, but a genuinely expensive query shape
// once one agent's queue reaches into the thousands (found via a real agent with 10,000+
// assigned debtors timing out the client's 8s fetch). Same ranked-window-function
// technique as getStaleCountsByFile, just returning the actual rows instead of a count.
export async function getRecentCallLogsByDebtor(debtorIds: string[], take = 5): Promise<Map<string, CallLogLite[]>> {
  const result = new Map<string, CallLogLite[]>();
  if (debtorIds.length === 0) return result;

  const rows = await prisma.$queryRaw<
    { debtorId: string; dispositionCode: string; createdAt: Date; promisedAmount: number | null; promisedDate: Date | null }[]
  >`
    WITH ranked AS (
      SELECT cl."debtorId" AS "debtorId", cl."dispositionCode" AS "dispositionCode",
             cl."createdAt" AS "createdAt", cl."promisedAmount" AS "promisedAmount",
             cl."promisedDate" AS "promisedDate",
             ROW_NUMBER() OVER (PARTITION BY cl."debtorId" ORDER BY cl."createdAt" DESC) AS rn
      FROM "CallLog" cl
      WHERE cl."debtorId" IN (${Prisma.join(debtorIds)})
    )
    SELECT "debtorId", "dispositionCode", "createdAt", "promisedAmount", "promisedDate"
    FROM ranked
    WHERE rn <= ${take}
    ORDER BY "debtorId", "createdAt" DESC
  `;

  for (const r of rows) {
    const existing = result.get(r.debtorId);
    const entry = { dispositionCode: r.dispositionCode, createdAt: r.createdAt, promisedAmount: r.promisedAmount, promisedDate: r.promisedDate };
    if (existing) existing.push(entry);
    else result.set(r.debtorId, [entry]);
  }
  return result;
}

// "Recently paid" badge source — has a ReconciliationEntry within the window, for many
// debtors at once instead of one `take: 1` relation fetch per debtor.
export async function getRecentlyPaidDebtorIds(debtorIds: string[], since: Date): Promise<Set<string>> {
  const result = new Set<string>();
  if (debtorIds.length === 0) return result;

  const rows = await prisma.reconciliationEntry.groupBy({
    by: ['debtorId'],
    where: { debtorId: { in: debtorIds }, createdAt: { gte: since } },
  });
  for (const r of rows) result.add(r.debtorId);
  return result;
}

// dashboard/summary's own "contacted" definition — the most recent call log isn't NA —
// which is a different question from getContactedCountsByFile ("has ever been called").
// Kept separate on purpose so the two never get merged.
export async function getLastCallNonNaCount(agentId?: string): Promise<number> {
  const rows = agentId
    ? await prisma.$queryRaw<{ count: number }[]>`
        WITH ranked AS (
          SELECT cl."debtorId" AS "debtorId", cl."dispositionCode" AS "dispositionCode",
                 ROW_NUMBER() OVER (PARTITION BY cl."debtorId" ORDER BY cl."createdAt" DESC) AS rn
          FROM "CallLog" cl
          WHERE cl."debtorId" IN (SELECT id FROM "Debtor" WHERE "assignedAgentId" = ${agentId})
        )
        SELECT COUNT(*) AS "count" FROM ranked WHERE rn = 1 AND "dispositionCode" != 'NA'
      `
    : await prisma.$queryRaw<{ count: number }[]>`
        WITH ranked AS (
          SELECT cl."debtorId" AS "debtorId", cl."dispositionCode" AS "dispositionCode",
                 ROW_NUMBER() OVER (PARTITION BY cl."debtorId" ORDER BY cl."createdAt" DESC) AS rn
          FROM "CallLog" cl
        )
        SELECT COUNT(*) AS "count" FROM ranked WHERE rn = 1 AND "dispositionCode" != 'NA'
      `;

  return Number(rows[0]?.count ?? 0);
}
