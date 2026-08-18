import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { processReconciliation } from '@/lib/reconciliation';
import type { ReconciliationRow } from '@/lib/excel';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  const reconciliation = await prisma.reconciliation.findUnique({ where: { id } });
  if (!reconciliation) return NextResponse.json({ error: 'Reconciliation not found' }, { status: 404 });
  if (!reconciliation.rawRows) return NextResponse.json({ error: 'No stored data to reprocess — log a new reconciliation instead' }, { status: 400 });
  if (reconciliation.status === 'processed') {
    return NextResponse.json({ error: 'Already processed — reprocessing would double-apply payments' }, { status: 400 });
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
