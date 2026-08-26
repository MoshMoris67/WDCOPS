import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';

interface Notification {
  id: string;
  kind: 'stale' | 'import_done' | 'import_failed' | 'file_uploaded' | 'reconciliation_uploaded';
  message: string;
  href: string;
}

// Computed on demand from data that already exists — no notification table, no
// read/unread state. Keeps this a real, useful feature without a new data model.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const mineOnly = new URL(req.url).searchParams.get('scope') === 'mine';
  const scopedToAgent = session.role === 'agent' || mineOnly;
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

  for (const r of staleRows) {
    notifications.push({
      id: `stale-${r.id}`,
      kind: 'stale',
      message: `${r.name} has gone 5+ calls with no answer`,
      href: `/debtor-detail-call-logging?id=${r.id}`,
    });
  }

  // Admin only: upload/import activity in the last hour — both the upload itself (so an
  // admin who wasn't the one uploading still sees it happened) and, separately, when a
  // large file's background import actually finishes (createdAt and updatedAt can both
  // land in this window for the same file, showing as two distinct events — "uploaded"
  // then later "finished importing" — which is accurate, not a duplicate).
  if (session.role === 'admin' && !mineOnly) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const recentFiles = await prisma.file.findMany({
      where: {
        importStatus: { in: ['complete', 'failed'] },
        updatedAt: { gte: oneHourAgo },
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

    const uploadedFiles = await prisma.file.findMany({
      where: { createdAt: { gte: oneHourAgo } },
      select: { id: true, batchLabel: true, createdAt: true, client: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    for (const f of uploadedFiles) {
      notifications.push({
        id: `file-uploaded-${f.id}`,
        kind: 'file_uploaded',
        message: `New file uploaded: "${f.batchLabel}" (${f.client.name})`,
        href: '/file-management-distribution',
      });
    }

    const uploadedRecons = await prisma.reconciliation.findMany({
      where: { createdAt: { gte: oneHourAgo } },
      select: { id: true, type: true, recordCount: true, createdAt: true, client: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    for (const r of uploadedRecons) {
      notifications.push({
        id: `recon-uploaded-${r.id}`,
        kind: 'reconciliation_uploaded',
        message: `New ${r.type} reconciliation uploaded for ${r.client.name} (${r.recordCount} record(s))`,
        href: '/reconciliation-management',
      });
    }
  }

  return NextResponse.json({ notifications });
}
