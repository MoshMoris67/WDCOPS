import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { processFileImportTick } from '@/lib/file-import';
import { processReconciliationTick, parseReconciliationUpload } from '@/lib/reconciliation';

// Soft time budget for the insert loop specifically — comfortably inside any reasonable
// request timeout on the host, regardless of file size; a 77,000-row file just takes
// several ticks instead of one. Doesn't cover the parse step processFileImportTick does
// before that loop on a file's first tick — parsing can't be interrupted and resumed
// partway through (see that function's comment), so it always runs to completion; if it's
// slow enough on this host to run past the insert loop's own budget, that tick just ends
// having parsed but inserted nothing, and the next tick 5 minutes later picks up the
// (already-parsed, now-fast) insert from a cold start. Tune down if the host's own
// request timeout turns out to be tighter than this in practice.
const TIME_BUDGET_MS = 20000;

/**
 * Called on a schedule by an external cron (see .github/workflows/worker-tick.yml), not
 * by anything in the app itself — Render's free web service has no background-worker
 * tier, so this does the work that used to run in a separate always-on process, one
 * bounded chunk at a time instead. No user session exists here to check, so this is
 * gated by a shared secret instead of requireRole().
 *
 * File imports (processFileImportTick) and reconciliation processing (processReconciliationTick)
 * are both chunked and resumable across ticks — a single tick just picks up wherever the
 * last one left off, for either. Parsing a reconciliation's upload
 * (parseReconciliationUpload), unlike processing it, is always its own tick turn rather
 * than being chained into the same call as processing: parsing can't itself be
 * interrupted and resumed partway through (see that function's comment), so keeping it
 * separate means one tick never has two unbounded steps stacked into a single request.
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

  const unparsedRecon = await prisma.reconciliation.findFirst({
    where: { status: 'pending', rawRows: null, rawFile: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (unparsedRecon) {
    const result = await parseReconciliationUpload(unparsedRecon.id);
    return NextResponse.json({ parsedReconciliation: { id: unparsedRecon.id, ...result } });
  }

  const recon = await prisma.reconciliation.findFirst({
    where: { status: 'pending', rawRows: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (recon) {
    const result = await processReconciliationTick(recon.id, TIME_BUDGET_MS);
    return NextResponse.json({ ranReconciliation: { id: recon.id, ...result } });
  }

  return NextResponse.json({ idle: true });
}
