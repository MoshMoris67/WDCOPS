import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';

/** Manual retry for a failed import — mirrors POST /api/reconciliations/[id]/process.
 *  Re-queues the already-stored raw upload (File.rawFile — no re-upload needed) for the
 *  next scheduled worker tick to pick up, rather than processing inline: a large import
 *  is exactly the kind of work that must never run inside a request. Leaves rowsProcessed
 *  untouched deliberately — runFileImport (lib/file-import.ts) checks it on its own to
 *  decide whether a prior attempt left partial debtors behind that need clearing before
 *  it streams the file again from scratch. Does reset importAttempts to 0 though — the
 *  automatic-retry cap (see api/worker/tick/route.ts) exists to stop the tick quietly
 *  re-crashing the instance forever on a file that's genuinely too large, not to permanently
 *  block an admin who's deliberately asking for one more try. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;

  const file = await prisma.file.findUnique({ where: { id } });
  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });
  if (!file.rawFile) {
    return NextResponse.json({ error: 'No stored data to reimport — re-upload the file instead' }, { status: 400 });
  }
  if (file.importStatus === 'complete') {
    return NextResponse.json({ error: 'Already imported — reimporting would create duplicate debtors' }, { status: 400 });
  }
  if (file.importStatus === 'queued' || file.importStatus === 'processing') {
    return NextResponse.json({ error: 'Already in progress' }, { status: 400 });
  }

  await prisma.file.update({ where: { id }, data: { importStatus: 'queued', importError: null, importAttempts: 0, parsingStartedAt: null } });

  return NextResponse.json({ file: { id, importStatus: 'queued' } });
}
