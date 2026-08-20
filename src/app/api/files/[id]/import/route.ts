import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';

/** Manual retry for a failed import — mirrors POST /api/reconciliations/[id]/process.
 *  Re-queues the already-parsed rows (kept in File.rawRows, no re-upload needed) for the
 *  next scheduled worker tick to pick up, rather than processing inline: a large import
 *  is exactly the kind of work that must never run inside a request. Deliberately leaves
 *  rowsProcessed untouched — a failure partway through already has some rows safely
 *  inserted, and resuming from there (not restarting at 0) is what avoids reinserting them. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;

  const file = await prisma.file.findUnique({ where: { id } });
  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });
  if (!file.rawRows) {
    return NextResponse.json({ error: 'No stored data to reimport — re-upload the file instead' }, { status: 400 });
  }
  if (file.importStatus === 'complete') {
    return NextResponse.json({ error: 'Already imported — reimporting would create duplicate debtors' }, { status: 400 });
  }
  if (file.importStatus === 'queued' || file.importStatus === 'processing') {
    return NextResponse.json({ error: 'Already in progress' }, { status: 400 });
  }

  await prisma.file.update({ where: { id }, data: { importStatus: 'queued', importError: null } });

  return NextResponse.json({ file: { id, importStatus: 'queued' } });
}
