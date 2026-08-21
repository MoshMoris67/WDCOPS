import { NextResponse, after } from 'next/server';
import { prisma } from '@/lib/db';
import { processFileImportTick } from '@/lib/file-import';
import { processReconciliationTick, parseReconciliationUpload } from '@/lib/reconciliation';

// Soft time budget for the insert/matching loops specifically — comfortably inside any
// reasonable request timeout on the host, regardless of file size; a 77,000-row file just
// takes several ticks instead of one. Doesn't bound the parse steps below at all — see
// the claim-and-detach comment on that section for why.
const TIME_BUDGET_MS = 20000;

// A claimed-but-unfinished parse older than this is treated as abandoned (the process
// that claimed it most likely restarted mid-parse — a redeploy, a crash) and can be
// re-claimed by the next tick. Generous on purpose: better to wait too long before
// retrying than to have two ticks parsing the same file at once.
const STALE_CLAIM_MS = 10 * 60 * 1000;

/**
 * Called on a schedule by an external cron (see .github/workflows/worker-tick.yml), not
 * by anything in the app itself — Render's free web service has no background-worker
 * tier, so this does the work that used to run in a separate always-on process, one
 * bounded chunk at a time instead. No user session exists here to check, so this is
 * gated by a shared secret instead of requireRole().
 *
 * File imports (processFileImportTick) and reconciliation processing (processReconciliationTick)
 * are both chunked and resumable across ticks, budget-bounded, and safe to await directly
 * — a single tick just picks up wherever the last one left off.
 *
 * Parsing (processFileImportTick's own first-tick step, and parseReconciliationUpload) is
 * different: it can't be split into bounded chunks (no cheap way to resume a spreadsheet
 * parse partway through — confirmed by direct timing), so it has to run to completion in
 * one go. That's a problem if awaited here: a parse slow enough on this host's CPU can
 * outlast Render's own inbound request timeout, and Render kills the connection out from
 * under it — confirmed happening in production (a stuck 'queued' file, the workflow log
 * showing a 502 after 2+ minutes).
 *
 * The fix is to never await it as part of this response: atomically claim the
 * file/reconciliation first (so a second tick firing while this is still running doesn't
 * launch a duplicate parse of the same one), then hand the parse to Next's after() — not
 * a bare unawaited promise. A plain "fire and forget" (call it, .catch() it, don't await
 * it) is NOT guaranteed to keep running once a Route Handler's response is sent; Next.js
 * makes no promise about that, which is exactly why after() exists — confirmed this was
 * the actual gap: ticks were succeeding fast (the claim + kickoff), but the background
 * work never completed, because nothing here told Next.js the request wasn't really over
 * yet. after() does, on every deployment target including a self-hosted `next start`. A
 * crash mid-parse (redeploy) just leaves it claimed until STALE_CLAIM_MS passes, then the
 * next tick retries it from scratch (parsing was never partially applied — it writes
 * rawRows in one shot at the end, not incrementally).
 */
export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const expected = process.env.WORKER_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);

  const file = await prisma.file.findFirst({
    where: { importStatus: { in: ['queued', 'processing'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, rawRows: true },
  });
  if (file) {
    if (!file.rawRows) {
      const claim = await prisma.file.updateMany({
        where: { id: file.id, rawRows: null, OR: [{ parsingStartedAt: null }, { parsingStartedAt: { lt: staleBefore } }] },
        data: { parsingStartedAt: new Date() },
      });
      if (claim.count === 0) {
        return NextResponse.json({ idle: true, note: 'a file parse is already in progress' });
      }
      after(processFileImportTick(file.id, TIME_BUDGET_MS).then(() => {}).catch(() => {}));
      return NextResponse.json({ startedParsingFile: file.id });
    }
    const result = await processFileImportTick(file.id, TIME_BUDGET_MS);
    return NextResponse.json({ ranFile: result });
  }

  const unparsedRecon = await prisma.reconciliation.findFirst({
    where: { status: 'pending', rawRows: null, rawFile: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (unparsedRecon) {
    const claim = await prisma.reconciliation.updateMany({
      where: { id: unparsedRecon.id, rawRows: null, OR: [{ parsingStartedAt: null }, { parsingStartedAt: { lt: staleBefore } }] },
      data: { parsingStartedAt: new Date() },
    });
    if (claim.count === 0) {
      return NextResponse.json({ idle: true, note: 'a reconciliation parse is already in progress' });
    }
    after(parseReconciliationUpload(unparsedRecon.id).then(() => {}).catch(() => {}));
    return NextResponse.json({ startedParsingReconciliation: unparsedRecon.id });
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
