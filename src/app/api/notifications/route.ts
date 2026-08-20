import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';

interface Notification {
  id: string;
  kind: 'ptp_due' | 'stale' | 'import_done' | 'import_failed';
  message: string;
  href: string;
}

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
function formatUGX(amount: number | null) {
  if (amount === null) return '';
  return 'UGX ' + amount.toLocaleString('en-UG');
}

// Computed on demand from data that already exists — no notification table, no
// read/unread state. Keeps this a real, useful feature without a new data model.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const mineOnly = new URL(req.url).searchParams.get('scope') === 'mine';
  const scopedToAgent = session.role === 'agent' || mineOnly;
  const today = startOfDay(new Date());
  const endToday = endOfDay(new Date());

  // Most recent call log per debtor, filtered to an active PTP due today or overdue —
  // same "isPTP"/"activePTP" definition as computeDebtorStatus (debtor-status.ts):
  // the LATEST call log, not just any PTP ever logged.
  const ptpRows = await prisma.$queryRawUnsafe<
    { id: string; name: string; promisedAmount: number | null; promisedDate: Date | null }[]
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
    SELECT d.id AS id, d.name AS name, r."promisedAmount" AS "promisedAmount", r."promisedDate" AS "promisedDate"
    FROM ranked r JOIN "Debtor" d ON d.id = r."debtorId"
    WHERE r.rn = 1 AND r."dispositionCode" = 'PTP' AND r."promisedDate" <= $2
    ORDER BY r."promisedDate" ASC
    LIMIT 5
    `,
    scopedToAgent ? session.sub : null,
    endToday
  );

  // Same "5+ most-recent calls all NA" definition as everywhere else this session
  // (debtor-aggregates.ts's getStaleCountsByFile) — here returning the actual debtors,
  // not just a count, since a notification needs something to link to.
  const staleRows = await prisma.$queryRawUnsafe<{ id: string; name: string }[]>(
    `
    WITH ranked AS (
      SELECT cl."debtorId" AS "debtorId", cl."dispositionCode" AS "dispositionCode",
             ROW_NUMBER() OVER (PARTITION BY cl."debtorId" ORDER BY cl."createdAt" DESC) AS rn
      FROM "CallLog" cl
      JOIN "Debtor" d ON d.id = cl."debtorId"
      WHERE ($1::text IS NULL OR d."assignedAgentId" = $1)
    ),
    stale AS (
      SELECT "debtorId" FROM ranked WHERE rn <= 5
      GROUP BY "debtorId"
      HAVING COUNT(*) = 5 AND SUM(CASE WHEN "dispositionCode" != 'NA' THEN 1 ELSE 0 END) = 0
    )
    SELECT d.id AS id, d.name AS name FROM stale s JOIN "Debtor" d ON d.id = s."debtorId"
    LIMIT 5
    `,
    scopedToAgent ? session.sub : null
  );

  const notifications: Notification[] = [];

  for (const r of ptpRows) {
    const overdue = r.promisedDate && r.promisedDate < today;
    notifications.push({
      id: `ptp-${r.id}`,
      kind: 'ptp_due',
      message: `${r.name}: PTP ${formatUGX(r.promisedAmount)} ${overdue ? 'overdue' : 'due today'}`,
      href: `/debtor-detail-call-logging?id=${r.id}`,
    });
  }
  for (const r of staleRows) {
    notifications.push({
      id: `stale-${r.id}`,
      kind: 'stale',
      message: `${r.name} has gone 5+ calls with no answer`,
      href: `/debtor-detail-call-logging?id=${r.id}`,
    });
  }

  // Admin only: files whose background import finished in the last hour.
  if (session.role === 'admin' && !mineOnly) {
    const recentFiles = await prisma.file.findMany({
      where: {
        importStatus: { in: ['complete', 'failed'] },
        updatedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
      select: { id: true, batchLabel: true, importStatus: true },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    });
    for (const f of recentFiles) {
      notifications.push({
        id: `import-${f.id}`,
        kind: f.importStatus === 'complete' ? 'import_done' : 'import_failed',
        message: f.importStatus === 'complete'
          ? `"${f.batchLabel}" finished importing`
          : `"${f.batchLabel}" failed to import`,
        href: '/file-management-distribution',
      });
    }
  }

  return NextResponse.json({ notifications });
}
