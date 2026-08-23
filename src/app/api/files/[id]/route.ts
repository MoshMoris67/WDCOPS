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

  // Postgres rejects a single query with more than 32,767 bind parameters — a file with
  // tens of thousands of debtors blew straight through that in one `IN (...debtorIds)`
  // clause (a real one hit this at 38,317), failing every deleteMany below outright and
  // rolling back the whole transaction, silently leaving the file undeleted no matter how
  // many times delete was retried. Chunking keeps each statement well under that ceiling.
  const CHUNK_SIZE = 5000;
  const chunks: string[][] = [];
  for (let i = 0; i < debtorIds.length; i += CHUNK_SIZE) chunks.push(debtorIds.slice(i, i + CHUNK_SIZE));

  // Interactive transaction (not the array/batch form) so a 120s timeout can be set — a
  // file this size, chunked into many statements, can outrun Prisma's 5s default.
  await prisma.$transaction(
    async (tx) => {
      // Reconciliations referencing this file stay (they're a client-facing audit log in
      // their own right) — just unlink the file so deleting it doesn't leave a dangling reference.
      await tx.reconciliation.updateMany({ where: { fileId: id }, data: { fileId: null } });
      for (const chunk of chunks) {
        await tx.reconciliationEntry.deleteMany({ where: { debtorId: { in: chunk } } });
        await tx.assignment.deleteMany({ where: { debtorId: { in: chunk } } });
        // Must run before debtor.deleteMany — CallLog.debtorId has no cascade, so a debtor
        // with logged calls would otherwise fail to delete on the foreign key.
        await tx.callLog.deleteMany({ where: { debtorId: { in: chunk } } });
      }
      await tx.debtor.deleteMany({ where: { fileId: id } });
      await tx.file.delete({ where: { id } });
    },
    { timeout: 120_000 }
  );

  return NextResponse.json({ ok: true });
}
