import { prisma } from './db';

export interface PtpRow {
  id: string;
  name: string;
  phone: string;
  clientId: string;
  clientName: string;
  agentId: string | null;
  agentName: string | null;
  promisedAmount: number | null;
  promisedDate: Date;
}

// "Active PTP" — same definition as debtor-status.ts's isPTP/activePTP (the debtor's
// LATEST call log, not just any PTP ever logged): a debtor whose most recent call has
// dispositionCode 'PTP'. Computed at the DB via the same ranked-window-function pattern
// as debtor-aggregates.ts's getStaleCountsByFile, scoped to one agent when agentId is
// passed (mirrors api/notifications' now-removed ptpRows query, minus the LIMIT 5 cap).
export async function getActivePtps(agentId?: string): Promise<PtpRow[]> {
  const rows = await prisma.$queryRawUnsafe<
    {
      id: string;
      name: string;
      phone: string;
      clientId: string;
      clientName: string;
      agentId: string | null;
      agentName: string | null;
      promisedAmount: number | null;
      promisedDate: Date;
    }[]
  >(
    `
    WITH ranked AS (
      SELECT cl."debtorId" AS "debtorId", cl."dispositionCode" AS "dispositionCode",
             cl."promisedAmount" AS "promisedAmount", cl."promisedDate" AS "promisedDate",
             ROW_NUMBER() OVER (PARTITION BY cl."debtorId" ORDER BY cl."createdAt" DESC) AS rn
      FROM "CallLog" cl
      JOIN "Debtor" d ON d.id = cl."debtorId"
      WHERE ($1::text IS NULL OR d."assignedAgentId" = $1)
    )
    SELECT d.id AS id, d.name AS name, d.phone1 AS phone,
           c.id AS "clientId", c.name AS "clientName",
           d."assignedAgentId" AS "agentId", u.name AS "agentName",
           r."promisedAmount" AS "promisedAmount", r."promisedDate" AS "promisedDate"
    FROM ranked r
    JOIN "Debtor" d ON d.id = r."debtorId"
    JOIN "File" f ON f.id = d."fileId"
    JOIN "Client" c ON c.id = f."clientId"
    LEFT JOIN "User" u ON u.id = d."assignedAgentId"
    WHERE r.rn = 1 AND r."dispositionCode" = 'PTP' AND r."promisedDate" IS NOT NULL
    ORDER BY r."promisedDate" ASC
    `,
    agentId ?? null
  );

  return rows;
}
