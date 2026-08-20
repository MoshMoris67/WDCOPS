import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { processReconciliation } from '@/lib/reconciliation';
import type { ReconciliationRow } from '@/lib/excel';

/**
 * Records a single debtor's payment without uploading a file — for the common case of
 * one person paying between reconciliation batches. Takes a *selected* debtorId, not a
 * typed loan-ref string: Debtor.loanRef has no uniqueness constraint in the schema, so
 * free-text matching could silently update the wrong debtor if two happened to share one,
 * or match nothing on a typo. The client/file context comes from the debtor that was
 * picked, not a separate selection step.
 *
 * Always type: 'partial' — "the amount collected" is inherently an incremental payment
 * event, not a restatement of the client's whole cumulative figure (what 'full' means
 * everywhere else in this system). Reuses processReconciliation with a one-row array;
 * that function has no special-casing on row count, and one row is fast enough to just
 * await directly here — no need to route this through the background worker.
 */
export async function POST(req: Request) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const body = await req.json().catch(() => null);
  const debtorId = typeof body?.debtorId === 'string' ? body.debtorId : '';
  const amount = Number(body?.amount);
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null;

  if (!debtorId) return NextResponse.json({ error: 'Select a debtor' }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Enter an amount greater than zero' }, { status: 400 });
  }

  const debtor = await prisma.debtor.findUnique({ where: { id: debtorId }, include: { file: true } });
  if (!debtor) return NextResponse.json({ error: 'Debtor not found' }, { status: 404 });

  const rows: ReconciliationRow[] = [
    { rowNumber: 1, loanRef: debtor.loanRef, phone: null, amount, name: null, amountOwed: null },
  ];

  const reconciliation = await prisma.reconciliation.create({
    data: {
      clientId: debtor.file.clientId,
      fileId: debtor.fileId,
      type: 'partial',
      receivedAt: new Date(),
      recordCount: 1,
      notes: note ?? 'Manual entry',
      rawRows: JSON.stringify(rows),
      status: 'pending',
    },
  });

  try {
    const result = await processReconciliation(reconciliation.id, debtor.file.clientId, 'partial', rows);
    const updated = await prisma.reconciliation.update({
      where: { id: reconciliation.id },
      data: {
        status: result.status,
        updatedCount: result.updatedCount,
        newAccountsCount: result.newAccountsCount,
        totalUpdated: result.totalUpdated,
        errorSummary: result.errorSummary,
        processedAt: new Date(),
      },
    });
    if (result.updatedCount === 0) {
      return NextResponse.json(
        { error: 'Could not match this payment to the debtor — check that the debtor still has the same loan reference on record.' },
        { status: 400 }
      );
    }
    return NextResponse.json({
      reconciliation: { id: updated.id, status: updated.status, totalAmountUpdated: updated.totalUpdated },
    }, { status: 201 });
  } catch (err) {
    await prisma.reconciliation.update({
      where: { id: reconciliation.id },
      data: { status: 'failed', errorSummary: err instanceof Error ? err.message : 'Processing failed', processedAt: new Date() },
    }).catch(() => {});
    return NextResponse.json({ error: 'Could not record this payment — try again' }, { status: 500 });
  }
}
