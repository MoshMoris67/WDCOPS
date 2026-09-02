import { NextResponse, after } from 'next/server';
import { prisma } from '@/lib/db';
import { runFileImport } from '@/lib/file-import';
import { runFileSync } from '@/lib/daily-sync';
import { processReconciliationTick, parseReconciliationUpload } from '@/lib/reconciliation';

// Soft time budget for reconciliation's matching loop specifically — comfortably inside
// any reasonable request timeout on the host. File import no longer needs a budget here:
// it streams the whole file in one continuous after()-scheduled pass (see runFileImport),
// not resumable ticks.
const TIME_BUDGET_MS = 20000;

// A claimed-but-unfinished import/parse older than this is treated as abandoned (the
// process that claimed it most likely restarted mid-run — a redeploy, a crash, an
// out-of-memory kill) and can be re-claimed by the next tick. Generous on purpose: better
// to wait too long before retrying than to have two ticks working the same one at once.
const STALE_CLAIM_MS = 10 * 60 * 1000;

// A file too large for available memory fails the exact same way every time it's retried
// — past this many attempts, stop retrying and mark it 'failed' outright instead of
// quietly re-crashing the instance on a fixed cadence forever.
const MAX_FILE_IMPORT_ATTEMPTS = 3;
const MAX_FILE_SYNC_ATTEMPTS = 3;

/**
 * Called on a schedule by an external cron (see .github/workflows/worker-tick.yml), not
 * by anything in the app itself — Render's free web service has no background-worker
 * tier, so this does the work that used to run in a separate always-on process instead.
 * No user session exists here to check, so this is gated by a shared secret instead of
 * requireRole().
 *
 * File import (runFileImport) streams the whole file — parse and insert together, row by
 * row — in one continuous pass, so there's nothing to await here beyond claiming it (see
 * that function's comment for why: a materialized rawRows array plus its JSON-stringified
 * copy is what crashed the Render instance with an out-of-memory kill on a 77,000-row
 * file). Reconciliation processing (processReconciliationTick) is chunked and
 * budget-bounded and safe to await directly — a single tick just picks up wherever the
 * last one left off. Reconciliation *parsing* (parseReconciliationUpload) still can't be
 * split into bounded chunks, so like file import it's handed off rather than awaited.
 *
 * Either way, the handoff has to go through Next's after(), not a bare unawaited promise:
 * a plain "fire and forget" (call it, .catch() it, don't await it) is NOT guaranteed to
 * keep running once a Route Handler's response is sent — Next.js makes no promise about
 * that, which is exactly why after() exists. Confirmed this was a real gap here, not just
 * theoretical: an earlier version of this handler used bare fire-and-forget and ticks kept
 * reporting success while the actual background work never completed. after() does keep
 * running it, on every deployment target including a self-hosted `next start`.
 *
 * Claiming first (a parsingStartedAt timestamp, guarded so two ticks can't claim the same
 * one at once) matters doubly here since crashes are now an expected, recoverable case
 * rather than a rare edge: a claimed-but-never-finished file/reconciliation just sits
 * until STALE_CLAIM_MS passes, then the next tick retries it — from scratch for a file
 * (streaming means there's no cursor to resume into; runFileImport deletes any partial
 * debtors a crashed attempt already inserted before restarting).
 */
export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const expected = process.env.WORKER_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);
  const claimable = { OR: [{ parsingStartedAt: null }, { parsingStartedAt: { lt: staleBefore } }] };

  // Filtering for claimability *in the same query* that picks which file/reconciliation
  // to work on — not just in the claim step after — matters: picking strictly "oldest
  // queued" and only then checking whether it can be claimed means a file that's stuck
  // claimed (a crash that never cleared parsingStartedAt — an out-of-memory kill isn't a
  // catchable JS error, so runFileImport's own try/catch never runs) head-of-line-blocks
  // every smaller file behind it in the queue for the entire STALE_CLAIM_MS window, tick
  // after tick, even though those smaller ones are perfectly claimable right now.
  // Confirmed happening in production: a large file OOM-crashed mid-run, and small files
  // uploaded afterward sat at "Importing..." untouched because this handler kept picking
  // the stuck large one first and giving up rather than trying the next.
  const file = await prisma.file.findFirst({
    where: { importStatus: { in: ['queued', 'processing'] }, ...claimable },
    orderBy: { createdAt: 'asc' },
    select: { id: true, importAttempts: true },
  });
  if (file) {
    if (file.importAttempts >= MAX_FILE_IMPORT_ATTEMPTS) {
      await prisma.file.update({
        where: { id: file.id },
        data: {
          importStatus: 'failed',
          importError: `Failed after ${MAX_FILE_IMPORT_ATTEMPTS} attempts, most likely too large to fit in this host's available memory. Try splitting it into smaller files, or ask about more memory for this app.`,
          parsingStartedAt: null,
        },
      });
      return NextResponse.json({ gaveUpOnFile: file.id });
    }
    const claim = await prisma.file.updateMany({
      where: { id: file.id, importStatus: { in: ['queued', 'processing'] }, ...claimable },
      data: { parsingStartedAt: new Date(), importAttempts: { increment: 1 } },
    });
    if (claim.count === 0) {
      // Another tick claimed it in the gap between our find and our claim — rare, harmless.
      return NextResponse.json({ idle: true, note: 'race — another tick just claimed this file' });
    }
    after(runFileImport(file.id).catch(() => {}));
    return NextResponse.json({ startedImportingFile: file.id });
  }

  // Same claim-then-run shape as file import above, one priority tier down — a daily sync
  // only ever targets a file that's already imported, so there's no ordering conflict with
  // the block above (a file mid-import can't have a sync queued against it yet).
  const fileSync = await prisma.fileSync.findFirst({
    where: { status: { in: ['queued', 'processing'] }, ...claimable },
    orderBy: { createdAt: 'asc' },
    select: { id: true, attempts: true },
  });
  if (fileSync) {
    if (fileSync.attempts >= MAX_FILE_SYNC_ATTEMPTS) {
      await prisma.fileSync.update({
        where: { id: fileSync.id },
        data: { status: 'failed', error: `Failed after ${MAX_FILE_SYNC_ATTEMPTS} attempts — most likely too large to fit in this host's available memory.`, parsingStartedAt: null },
      });
      return NextResponse.json({ gaveUpOnFileSync: fileSync.id });
    }
    const claim = await prisma.fileSync.updateMany({
      where: { id: fileSync.id, status: { in: ['queued', 'processing'] }, ...claimable },
      data: { parsingStartedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claim.count === 0) {
      return NextResponse.json({ idle: true, note: 'race — another tick just claimed this file sync' });
    }
    after(runFileSync(fileSync.id).catch(() => {}));
    return NextResponse.json({ startedFileSync: fileSync.id });
  }

  const unparsedRecon = await prisma.reconciliation.findFirst({
    where: { status: 'pending', rawRows: null, rawFile: { not: null }, ...claimable },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (unparsedRecon) {
    const claim = await prisma.reconciliation.updateMany({
      where: { id: unparsedRecon.id, rawRows: null, ...claimable },
      data: { parsingStartedAt: new Date() },
    });
    if (claim.count === 0) {
      return NextResponse.json({ idle: true, note: 'race — another tick just claimed this reconciliation' });
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
