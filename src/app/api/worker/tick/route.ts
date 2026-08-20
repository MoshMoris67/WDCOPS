import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { processFileImportTick } from '@/lib/file-import';
import { processReconciliation } from '@/lib/reconciliation';
import type { ReconciliationRow } from '@/lib/excel';

// Soft time budget per tick — comfortably inside any reasonable request timeout on the
// host, regardless of file size. A 77,000-row file just takes several ticks instead of
// one; each individual request stays fast either way. Tune down if the host's own
// timeout turns out to be tighter than this in practice.
const TIME_BUDGET_MS = 20000;

/**
 * Called on a schedule by an external cron (see .github/workflows/worker-tick.yml), not
 * by anything in the app itself — Render's free web service has no background-worker
 * tier, so this does the work that used to run in a separate always-on process, one
 * bounded chunk at a time instead. No user session exists here to check, so this is
 * gated by a shared secret instead of requireRole().
 *
 * File imports are chunked and resumable across ticks (see processFileImportTick) since
 * that's the actual reported failure — a single tick just picks up wherever the last one
 * left off. Reconciliation processing is NOT chunked (see src/lib/reconciliation.ts) —
 * still a real gap for a genuinely huge reconciliation file, flagged when this was built
 * and not solved here; the file-import path is what was actually failing in practice.
 */
export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const expected = process.env.WORKER_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const file = await prisma.file.findFirst({
    where: { importStatus: { in: ['queued', 'processing'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (file) {
    const result = await processFileImportTick(file.id, TIME_BUDGET_MS);
    return NextResponse.json({ ranFile: result });
  }

  const recon = await prisma.reconciliation.findFirst({
    where: { status: 'pending', rawRows: { not: null } },
    orderBy: { createdAt: 'asc' },
  });
  if (recon && recon.rawRows) {
    const rows: ReconciliationRow[] = JSON.parse(recon.rawRows);
    try {
      const result = await processReconciliation(recon.id, recon.clientId, recon.type as 'full' | 'partial', rows);
      await prisma.reconciliation.update({
        where: { id: recon.id },
        data: {
          status: result.status,
          updatedCount: result.updatedCount,
          newAccountsCount: result.newAccountsCount,
          totalUpdated: result.totalUpdated,
          errorSummary: result.errorSummary,
          processedAt: new Date(),
        },
      });
      return NextResponse.json({ ranReconciliation: { id: recon.id, status: result.status, updatedCount: result.updatedCount } });
    } catch (err) {
      await prisma.reconciliation
        .update({
          where: { id: recon.id },
          data: { status: 'failed', errorSummary: err instanceof Error ? err.message : 'Processing failed', processedAt: new Date() },
        })
        .catch(() => {});
      return NextResponse.json({ ranReconciliation: { id: recon.id, status: 'failed' } });
    }
  }

  return NextResponse.json({ idle: true });
}
