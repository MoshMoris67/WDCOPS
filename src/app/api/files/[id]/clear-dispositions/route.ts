import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { deleteCallLogsForDebtors } from '@/lib/debtor-delete';

/** How many calls would be cleared — nothing is changed. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  const file = await prisma.file.findUnique({ where: { id }, select: { id: true } });
  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });

  const [callCount, debtorCount] = await Promise.all([
    prisma.callLog.count({ where: { debtor: { fileId: id } } }),
    prisma.debtor.count({ where: { fileId: id, callLogs: { some: {} } } }),
  ]);
  return NextResponse.json({ callCount, debtorCount });
}

/** Hard clear: deletes every call (disposition, notes, promises, corrections) logged
 *  against this file's debtors, so each starts uncalled. Balances and payments are
 *  untouched. No undo — the UI downloads an export first. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  const file = await prisma.file.findUnique({ where: { id }, select: { id: true } });
  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });

  const debtorIds = (await prisma.debtor.findMany({ where: { fileId: id }, select: { id: true } })).map((d) => d.id);
  const clearedCount = await prisma.$transaction((tx) => deleteCallLogsForDebtors(tx, debtorIds), { timeout: 120_000 });
  return NextResponse.json({ ok: true, clearedCount });
}
