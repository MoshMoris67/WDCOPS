import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  const body = await req.json().catch(() => null);

  const data: { batchLabel?: string; receivedDate?: Date; isMidMonthTopup?: boolean; isRecalled?: boolean } = {};

  if (typeof body?.batchLabel === 'string') {
    const label = body.batchLabel.trim();
    if (!label) return NextResponse.json({ error: 'Batch label cannot be blank' }, { status: 400 });
    data.batchLabel = label;
  }
  if (typeof body?.receivedDate === 'string' && body.receivedDate) {
    data.receivedDate = new Date(body.receivedDate);
  }
  if (typeof body?.isMidMonthTopup === 'boolean') data.isMidMonthTopup = body.isMidMonthTopup;
  if (typeof body?.isRecalled === 'boolean') data.isRecalled = body.isRecalled;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const updated = await prisma.file.update({ where: { id }, data }).catch(() => null);
  if (!updated) return NextResponse.json({ error: 'File not found' }, { status: 404 });

  return NextResponse.json({
    file: {
      id: updated.id,
      batchLabel: updated.batchLabel,
      receivedDate: updated.receivedDate,
      isMidMonthTopup: updated.isMidMonthTopup,
      isRecalled: updated.isRecalled,
    },
  });
}

/** Permanently deletes a file and everything tied to its debtors — including call logs.
 *  Deliberately allowed even when calls have been logged (an explicit, admin-only choice:
 *  this used to be blocked to protect the audit trail, but is now a real requested
 *  capability for cleaning up a mistaken/duplicate import). There is no undo — the
 *  frontend confirmation dialog says so in plain terms before this ever runs. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;

  const file = await prisma.file.findUnique({ where: { id } });
  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });

  const debtorIds = (await prisma.debtor.findMany({ where: { fileId: id }, select: { id: true } })).map((d) => d.id);

  await prisma.$transaction([
    // Reconciliations referencing this file stay (they're a client-facing audit log in their own
    // right) — just unlink the file so deleting it doesn't leave a dangling reference.
    prisma.reconciliation.updateMany({ where: { fileId: id }, data: { fileId: null } }),
    prisma.reconciliationEntry.deleteMany({ where: { debtorId: { in: debtorIds } } }),
    prisma.assignment.deleteMany({ where: { debtorId: { in: debtorIds } } }),
    // Must run before debtor.deleteMany — CallLog.debtorId has no cascade, so a debtor
    // with logged calls would otherwise fail to delete on the foreign key.
    prisma.callLog.deleteMany({ where: { debtorId: { in: debtorIds } } }),
    prisma.debtor.deleteMany({ where: { fileId: id } }),
    prisma.file.delete({ where: { id } }),
  ]);

  return NextResponse.json({ ok: true });
}
