import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { deleteDebtorsByIds } from '@/lib/debtor-delete';

/**
 * Permanently deletes specific debtors by ID — the bulk counterpart to a client
 * insourcing (taking back) a list of accounts. Unlike DELETE /api/files/[id], this isn't
 * scoped to one file: an admin can remove debtors spanning any number of that client's
 * batches in one action, matched beforehand via POST /api/debtors/bulk-remove/preview.
 * No undo, same as the existing file-delete action — the frontend confirms in plain
 * terms before this ever runs.
 */
export async function POST(req: Request) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const body = await req.json().catch(() => null);
  const debtorIds: string[] = Array.isArray(body?.debtorIds)
    ? body.debtorIds.filter((v: unknown): v is string => typeof v === 'string')
    : [];

  if (debtorIds.length === 0) return NextResponse.json({ error: 'debtorIds is required' }, { status: 400 });

  const existing = await prisma.debtor.findMany({ where: { id: { in: debtorIds } }, select: { id: true } });
  const existingIds = existing.map((d) => d.id);

  await deleteDebtorsByIds(existingIds);

  return NextResponse.json({ deletedCount: existingIds.length });
}
