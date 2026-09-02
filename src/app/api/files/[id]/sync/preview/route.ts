import { NextResponse } from 'next/server';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { previewTwoSheets, suggestImportMapping, suggestSyncPaymentMapping, SUPPORTED_IMPORT_EXTENSIONS } from '@/lib/excel';

/** Headers + a sample from a daily sync file's first two sheets (calling list, payments),
 * plus a best-guess mapping for each — no database writes. */
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
  let preview;
  try {
    preview = await previewTwoSheets(buffer, file.name);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not read this file' }, { status: 400 });
  }
  if (preview.callingList.headers.length === 0 || preview.payments.headers.length === 0) {
    return NextResponse.json({ error: 'Could not find a header row on one of the first two sheets' }, { status: 400 });
  }

  return NextResponse.json({
    callingList: { ...preview.callingList, suggested: suggestImportMapping(preview.callingList.headers) },
    payments: { ...preview.payments, suggested: suggestSyncPaymentMapping(preview.payments.headers) },
  });
}
