import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { processReconciliationTick, parseReconciliationUpload } from '@/lib/reconciliation';

// More generous than the cron tick's own budget (see api/worker/tick/route.ts) since this
// is a single explicit foreground request, not a call that repeats every 5 minutes either
// way — but still bounded, so even "process now" on a huge reconciliation can't hang
// indefinitely. If it doesn't finish in one pass, it's already made real progress
// (rowsProcessed persisted per batch) and the next cron tick picks up from there.
const TIME_BUDGET_MS = 25000;

/** "Process now" — admin explicitly asked for this to happen immediately rather than
 *  waiting for the next scheduled tick, so unlike the tick itself this parses (if the
 *  upload hasn't been parsed into rawRows yet — e.g. clicked right after uploading, before
 *  any tick ran) and processes in the same request. Processing itself is chunked/batched
 *  (see processReconciliationTick) — for anything but a very large file this finishes in
 *  one call same as before; for a huge one it reports partial progress instead of hanging. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  const reconciliation = await prisma.reconciliation.findUnique({ where: { id } });
  if (!reconciliation) return NextResponse.json({ error: 'Reconciliation not found' }, { status: 404 });
  if (reconciliation.status === 'processed') {
    return NextResponse.json({ error: 'Already processed — reprocessing would double-apply payments' }, { status: 400 });
  }
  if (!reconciliation.rawRows && !reconciliation.rawFile) {
    return NextResponse.json({ error: 'No stored data to reprocess — log a new reconciliation instead' }, { status: 400 });
  }

  if (!reconciliation.rawRows) {
    const parseResult = await parseReconciliationUpload(id);
    if (!parseResult.parsed) {
      const failed = await prisma.reconciliation.findUnique({ where: { id } });
      return NextResponse.json({ error: failed?.errorSummary ?? 'Could not parse the uploaded file' }, { status: 400 });
    }
  }

  const tickResult = await processReconciliationTick(id, TIME_BUDGET_MS);
  const updated = await prisma.reconciliation.findUnique({ where: { id } });

  if (!tickResult.done) {
    return NextResponse.json({
      reconciliation: { id, status: updated?.status ?? 'pending', updatedCount: updated?.updatedCount ?? 0, newAccountsCount: updated?.newAccountsCount ?? 0 },
      inProgress: true,
      message: `Still working — ${updated?.rowsProcessed ?? 0} of ${updated?.recordCount ?? 0} row(s) done so far. It'll keep going in the background.`,
    });
  }

  return NextResponse.json({
    reconciliation: { id, status: updated?.status, updatedCount: updated?.updatedCount, newAccountsCount: updated?.newAccountsCount },
  });
}
