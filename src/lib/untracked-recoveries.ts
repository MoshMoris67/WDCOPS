import { Prisma } from '@prisma/client';
import { prisma } from './db';

export interface UntrackedRecoveryFile {
  fileId: string;
  batchLabel: string | null;
  debtorCount: number;
  amount: number;
}

// A debtor's cumulativePaid only ever rises through a ReconciliationEntry recording the
// increment (file import and daily-sync's new debtors start at 0; see file-import.ts), and
// deleting a reconciliation takes back exactly what its entries recorded. So any
// cumulativePaid above the sum of a debtor's remaining entries is money no reconciliation
// accounts for — left behind by a partial failure or a racing delete from before those
// paths were made atomic — and nothing in the log can ever reverse it. The reverse case
// (entries summing to more than cumulativePaid) is normal: a full reconciliation that
// lowers a figure records a 0 increment, not a negative one, so it is left alone here.
const UNTRACKED = (clientId: string) => Prisma.sql`
  SELECT d.id, d."fileId", d."amountOwed", d."cumulativePaid",
         COALESCE(SUM(e."paidAmount"), 0) AS tracked
  FROM "Debtor" d
  JOIN "File" f ON f.id = d."fileId"
  LEFT JOIN "ReconciliationEntry" e ON e."debtorId" = d.id
  WHERE f."clientId" = ${clientId} AND d."cumulativePaid" > 0
  GROUP BY d.id
  HAVING d."cumulativePaid" - COALESCE(SUM(e."paidAmount"), 0) > 0.005
`;

export async function findUntrackedRecoveries(clientId: string): Promise<UntrackedRecoveryFile[]> {
  const rows = await prisma.$queryRaw<{ fileId: string; batchLabel: string | null; debtorCount: number; amount: number }[]>`
    SELECT u."fileId" AS "fileId", f."batchLabel" AS "batchLabel",
           COUNT(*)::int AS "debtorCount", SUM(u."cumulativePaid" - u.tracked) AS amount
    FROM (${UNTRACKED(clientId)}) u
    JOIN "File" f ON f.id = u."fileId"
    GROUP BY u."fileId", f."batchLabel"
    ORDER BY amount DESC
  `;
  return rows.map((r) => ({ ...r, debtorCount: Number(r.debtorCount), amount: Number(r.amount) }));
}

/** Brings every such debtor's cumulativePaid (and balance) back down to what its entries
 *  account for. Admin-triggered only, after reviewing findUntrackedRecoveries' preview. */
export async function repairUntrackedRecoveries(clientId: string): Promise<{ debtorCount: number }> {
  const debtorCount = await prisma.$executeRaw`
    UPDATE "Debtor" d
    SET "cumulativePaid" = u.tracked,
        "balance" = GREATEST(0, d."amountOwed" - u.tracked)
    FROM (${UNTRACKED(clientId)}) u
    WHERE d.id = u.id
  `;
  return { debtorCount };
}
