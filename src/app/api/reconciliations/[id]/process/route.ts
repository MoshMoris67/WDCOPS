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
const STALE_CLAIM_MS = 10 * 60 * 1000;

/**
 * "Process now" — admin explicitly asked for this to happen immediately rather than
 * waiting for the next scheduled tick. Processing itself (matching rows against debtors)
 * is chunked/budget-bounded (see processReconciliationTick), so it's safe to await
 * directly here — for anything but a very large file this finishes in one call; for a
 * huge one it reports partial progress instead of hanging.
 *
 * Parsing the raw upload (if a tick hasn't gotten to it yet — e.g. clicked right after
 * uploading) is NOT safe to await here: it can't be split into bounded chunks, and this
 * request goes through the exact same Render proxy the cron tick does — a slow enough
 * parse can outlast that proxy's own timeout and get this request killed before it ever
 * responds (confirmed happening to the cron tick in production; the browser click would
 * fail the identical way). So when parsing is still needed, this claims it (same
 * atomic claim as the tick, so both can't parse it at once) and kicks it off
 * fire-and-forget, returning immediately with "still parsing" instead of trying to wait
 * it out.
 */
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
    const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);
    const claim = await prisma.reconciliation.updateMany({
      where: { id, rawRows: null, OR: [{ parsingStartedAt: null }, { parsingStartedAt: { lt: staleBefore } }] },
      data: { parsingStartedAt: new Date() },
    });
    if (claim.count > 0) {
      parseReconciliationUpload(id).catch(() => {});
    }
    return NextResponse.json({
      reconciliation: { id, status: 'pending', updatedCount: 0, newAccountsCount: 0 },
      inProgress: true,
      message: claim.count > 0
        ? "Parsing the file now — this can take a little while for a large upload. Check back shortly, or just click Process Now again once it's done."
        : "Already parsing (started by an earlier click or the background tick) — check back shortly.",
    });
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
