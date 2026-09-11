import { prisma } from './db';

export interface CallbackRow {
  id: string;
  name: string;
  phone: string;
  clientId: string;
  clientName: string;
  agentId: string | null;
  agentName: string | null;
  callbackDate: Date;
}

// "Active callback" — same "latest call log per debtor" pattern as getActivePtps in
// ptp.ts, but scoped by DispositionCode.requiresCallback instead of a hardcoded code,
// since which codes schedule a callback is admin-configurable (see admin-settings).
// The callback date/time itself lives in CallLog.promisedDate — DebtorDetailContent
// writes the agent's chosen date+time there for any requiresCallback disposition.
export async function getActiveCallbacks(agentId?: string): Promise<CallbackRow[]> {
  const rows = await prisma.$queryRawUnsafe<
    {
      id: string;
      name: string;
      phone: string;
      clientId: string;
      clientName: string;
      agentId: string | null;
      agentName: string | null;
      callbackDate: Date;
    }[]
  >(
    `
    WITH ranked AS (
      SELECT cl."debtorId" AS "debtorId", cl."dispositionCode" AS "dispositionCode",
             cl."promisedDate" AS "promisedDate",
             ROW_NUMBER() OVER (PARTITION BY cl."debtorId" ORDER BY cl."createdAt" DESC) AS rn
      FROM "CallLog" cl
      JOIN "Debtor" d ON d.id = cl."debtorId"
      WHERE ($1::text IS NULL OR d."assignedAgentId" = $1)
    )
    SELECT d.id AS id, d.name AS name, d.phone1 AS phone,
           c.id AS "clientId", c.name AS "clientName",
           d."assignedAgentId" AS "agentId", u.name AS "agentName",
           r."promisedDate" AS "callbackDate"
    FROM ranked r
    JOIN "Debtor" d ON d.id = r."debtorId"
    JOIN "File" f ON f.id = d."fileId"
    JOIN "Client" c ON c.id = f."clientId"
    JOIN "DispositionCode" dc ON dc.code = r."dispositionCode"
    LEFT JOIN "User" u ON u.id = d."assignedAgentId"
    WHERE r.rn = 1 AND dc."requiresCallback" = true AND r."promisedDate" IS NOT NULL
    ORDER BY r."promisedDate" ASC
    `,
    agentId ?? null
  );

  return rows;
}
