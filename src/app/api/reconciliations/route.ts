import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { SUPPORTED_IMPORT_EXTENSIONS, type ReconciliationMapping } from '@/lib/excel';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const reconciliations = await prisma.reconciliation.findMany({
    include: { client: true, file: true },
    orderBy: { receivedAt: 'desc' },
  });

  return NextResponse.json({
    reconciliations: reconciliations.map((r) => ({
      id: r.id,
      client: r.client.name,
      fileId: r.fileId,
      batchLabel: r.file?.batchLabel ?? null,
      type: r.type,
      receivedAt: r.receivedAt,
      processedAt: r.processedAt,
      recordCount: r.recordCount,
      updatedCount: r.updatedCount,
      newAccountsCount: r.newAccountsCount,
      totalAmountUpdated: r.totalUpdated,
      status: r.status,
      errorSummary: r.errorSummary,
      notes: r.notes,
    })),
  });
}

export async function POST(req: Request) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });

  const clientId = String(form.get('clientId') ?? '');
  const fileId = String(form.get('fileId') ?? '') || null;
  const type = String(form.get('reconciliationType') ?? '');
  const receivedDate = String(form.get('receivedDate') ?? '');
  const receivedTime = String(form.get('receivedTime') ?? '') || '00:00';
  const notes = String(form.get('notes') ?? '') || null;
  const mappingRaw = String(form.get('mapping') ?? '');
  const file = form.get('file');

  if (!clientId || (type !== 'full' && type !== 'partial') || !receivedDate || !(file instanceof File)) {
    return NextResponse.json({ error: 'clientId, reconciliationType, receivedDate, and file are required' }, { status: 400 });
  }
  if (!SUPPORTED_IMPORT_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
    return NextResponse.json({ error: `Unsupported file type — use ${SUPPORTED_IMPORT_EXTENSIONS.join(' or ')}` }, { status: 400 });
  }

  if (!mappingRaw) {
    return NextResponse.json({ error: 'Column mapping is required — preview the file and confirm the mapping first' }, { status: 400 });
  }
  let mapping: ReconciliationMapping;
  try {
    mapping = JSON.parse(mappingRaw) as ReconciliationMapping;
  } catch {
    return NextResponse.json({ error: 'Invalid column mapping' }, { status: 400 });
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return NextResponse.json({ error: 'Unknown client' }, { status: 400 });

  // Parsing used to happen right here, synchronously — the same class of bug that made
  // large file imports hang the browser (see src/lib/excel.ts / src/lib/file-import.ts).
  // This route now does the minimum: store the raw upload + the mapping already confirmed
  // in the preview step, and return immediately. The worker tick (POST /api/worker/tick)
  // parses it into rawRows as its own step on its next run, then processes it exactly as
  // before — see prisma/schema.prisma's Reconciliation comment for the full sequence.
  const buffer = await file.arrayBuffer();
  const reconciliation = await prisma.reconciliation.create({
    data: {
      clientId,
      fileId,
      type,
      receivedAt: new Date(`${receivedDate}T${receivedTime}`),
      recordCount: 0,
      notes,
      rawFile: Buffer.from(buffer).toString('base64'),
      rawFileName: file.name,
      mapping: JSON.stringify(mapping),
      status: 'pending',
    },
  });

  return NextResponse.json(
    { reconciliation: { id: reconciliation.id, status: 'pending' } },
    { status: 201 }
  );
}
