import { NextResponse } from 'next/server';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { buildDispositionsExport } from '@/lib/new-month';
import { attachmentDisposition } from '@/lib/content-disposition';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  try {
    const built = await buildDispositionsExport(id);
    if (!built) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    return new NextResponse(new Blob([new Uint8Array(built.buffer)]), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': attachmentDisposition(`${built.label}-dispositions.xlsx`),
      },
    });
  } catch (err) {
    console.error('Dispositions export failed', err);
    return NextResponse.json({ error: 'Could not build the export — nothing was changed' }, { status: 500 });
  }
}
