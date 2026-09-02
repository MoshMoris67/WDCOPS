import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { previewDistributedSheets, matchAgentBySheetName, suggestImportMapping, SUPPORTED_IMPORT_EXTENSIONS } from '@/lib/excel';

/** Same idea as /api/files/preview, plus every sheet's name/row count matched against the
 * real user roster — for a file already distributed by agent outside the app. No database
 * writes. */
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
    preview = await previewDistributedSheets(buffer, file.name);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not read this file' }, { status: 400 });
  }
  if (preview.headers.length === 0) {
    return NextResponse.json({ error: 'Could not find a header row in this file' }, { status: 400 });
  }
  if (preview.sheets.length < 2) {
    return NextResponse.json({ error: 'This file only has one sheet — use the normal import instead' }, { status: 400 });
  }

  const agents = await prisma.user.findMany({
    where: { role: { in: ['admin', 'agent'] }, status: 'active' },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  const sheets = preview.sheets.map((s) => ({ ...s, matchedAgent: matchAgentBySheetName(s.name, agents) }));

  // Default suggestion only — a pre-filled dropdown value the admin confirms or changes,
  // never applied silently. The combined/reference sheet a client sends alongside their
  // per-agent tabs (e.g. "FILE" duplicating everyone) is typically the largest by row
  // count, since it's the union of every agent's sheet.
  const suggestedMasterSheet = sheets.reduce<typeof sheets[number] | null>(
    (max, s) => (s.rowCount > (max?.rowCount ?? -1) ? s : max),
    null
  )?.name ?? null;

  return NextResponse.json({
    headers: preview.headers,
    sampleRows: preview.sampleRows,
    suggested: suggestImportMapping(preview.headers),
    sheets,
    suggestedMasterSheet,
    agents,
  });
}
