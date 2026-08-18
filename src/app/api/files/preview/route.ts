import { NextResponse } from 'next/server';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { previewImportFile, SUPPORTED_IMPORT_EXTENSIONS } from '@/lib/excel';

/** Reads just the headers + a few sample rows of a file, plus a best-guess column mapping — no database writes. */
export async function POST(req: Request) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 });
  if (!SUPPORTED_IMPORT_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
    return NextResponse.json({ error: `Unsupported file type — use ${SUPPORTED_IMPORT_EXTENSIONS.join(' or ')}` }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  const preview = await previewImportFile(buffer, file.name);

  if (preview.headers.length === 0) {
    return NextResponse.json({ error: 'Could not find a header row in this file' }, { status: 400 });
  }

  return NextResponse.json(preview);
}
