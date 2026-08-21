import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { processReconciliation, parseReconciliationUpload } from '@/lib/reconciliation';
import type { ReconciliationRow } from '@/lib/excel';

/** "Process now" — admin explicitly asked for this to happen immediately rather than
 *  waiting for the next scheduled tick, so unlike the tick itself this parses (if the
 *  upload hasn't been parsed into rawRows yet — e.g. clicked right after uploading, before
 *  any tick ran) and processes in the same request. That's consistent with what this
 *  button already did before rawFile/rawRows was a two-stage thing: process synchronously,
 *  on demand. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  let reconciliation = await prisma.reconciliation.findUnique({ where: { id } });
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
    reconciliation = await prisma.reconciliation.findUnique({ where: { id } });
    if (!reconciliation?.rawRows) return NextResponse.json({ error: 'Could not parse the uploaded file' }, { status: 400 });
  }

  const rows: ReconciliationRow[] = JSON.parse(reconciliation.rawRows);
  const result = await processReconciliation(id, reconciliation.clientId, reconciliation.type as 'full' | 'partial', rows);

  const updated = await prisma.reconciliation.update({
    where: { id },
    data: {
      status: result.status,
      updatedCount: result.updatedCount,
      newAccountsCount: result.newAccountsCount,
      totalUpdated: result.totalUpdated,
      errorSummary: result.errorSummary,
      processedAt: new Date(),
    },
  });

  return NextResponse.json({
    reconciliation: { id: updated.id, status: updated.status, updatedCount: updated.updatedCount, newAccountsCount: updated.newAccountsCount },
  });
}
