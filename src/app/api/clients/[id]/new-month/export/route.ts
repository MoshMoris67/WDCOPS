import { NextResponse } from 'next/server';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { buildNewMonthExport } from '@/lib/new-month';
import { attachmentDisposition } from '@/lib/content-disposition';

/** Workbook of everything the new-month action will delete or reset — the UI downloads it
 *  before it will run the action. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  try {
    const built = await buildNewMonthExport(id);
    if (!built) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    return new NextResponse(new Blob([new Uint8Array(built.buffer)]), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': attachmentDisposition(`${built.clientName}-before-new-month-${new Date().toISOString().slice(0, 10)}.xlsx`),
      },
    });
  } catch (err) {
    console.error('New-month export failed', err);
    return NextResponse.json({ error: 'Could not build the export — nothing was changed' }, { status: 500 });
  }
}
