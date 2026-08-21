import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { reverseAndDeleteReconciliation } from '@/lib/reconciliation';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id } = await params;
  const r = await prisma.reconciliation.findUnique({ where: { id }, include: { client: true, file: true } });
  if (!r) return NextResponse.json({ error: 'Reconciliation not found' }, { status: 404 });

  return NextResponse.json({
    reconciliation: {
      id: r.id,
      client: r.client.name,
      fileId: r.fileId,
      batchLabel: r.file?.batchLabel ?? null,
      type: r.type,
      receivedAt: r.receivedAt,
      processedAt: r.processedAt,
      recordCount: r.recordCount,
      updatedCount: r.updatedCount,
      newAccountsCount: r.newAccountsCount,
      totalAmountUpdated: r.totalUpdated,
      status: r.status,
      errorSummary: r.errorSummary,
      notes: r.notes,
    },
  });
}

/** Metadata only — notes and the received date/time. Never `type` or any of the
 *  count/amount fields: those are a record of what actually happened to debtor balances
 *  when this was processed, not editable inputs, and changing them after the fact would
 *  desync the record from reality without touching a single balance it already updated. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  const body = await req.json().catch(() => null);

  const data: { notes?: string | null; receivedAt?: Date } = {};
  if (typeof body?.notes === 'string' || body?.notes === null) {
    data.notes = typeof body.notes === 'string' ? (body.notes.trim() || null) : null;
  }
  if (typeof body?.receivedAt === 'string' && body.receivedAt) {
    const parsed = new Date(body.receivedAt);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: 'Invalid receivedAt date' }, { status: 400 });
    }
    data.receivedAt = parsed;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const updated = await prisma.reconciliation.update({ where: { id }, data }).catch(() => null);
  if (!updated) return NextResponse.json({ error: 'Reconciliation not found' }, { status: 404 });

  return NextResponse.json({ reconciliation: { id: updated.id, notes: updated.notes, receivedAt: updated.receivedAt } });
}

/**
 * Deletes a reconciliation and reverses the balance changes it made — an admin-only,
 * no-undo action (mirrors the same explicit choice already made for file deletion in
 * api/files/[id]/route.ts: "delete it and its data" means the effect goes away too, not
 * just the record). See lib/reconciliation.ts's reverseAndDeleteReconciliation for how
 * the reversal itself works and why it's exact even if other reconciliations have since
 * touched the same debtors, and why new accounts it created are never deleted.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  const r = await prisma.reconciliation.findUnique({ where: { id } });
  if (!r) return NextResponse.json({ error: 'Reconciliation not found' }, { status: 404 });

  const { reversedCount } = await reverseAndDeleteReconciliation(id);
  return NextResponse.json({ ok: true, reversedCount });
}
