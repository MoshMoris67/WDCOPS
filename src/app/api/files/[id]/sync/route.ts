import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { SUPPORTED_IMPORT_EXTENSIONS, type ImportMapping, type SyncPaymentMapping } from '@/lib/excel';

/** Most recent sync run for this file, if any — for a "Last Sync" readout. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  const latest = await prisma.fileSync.findFirst({
    where: { fileId: id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, error: true, newDebtorsCount: true, paymentsAppliedCount: true, paymentsSkippedCount: true, createdAt: true, completedAt: true },
  });

  return NextResponse.json({ latest });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  const targetFile = await prisma.file.findUnique({ where: { id }, select: { id: true, isRecalled: true } });
  if (!targetFile) return NextResponse.json({ error: 'File not found' }, { status: 404 });
  if (targetFile.isRecalled) return NextResponse.json({ error: 'This file is recalled — reactivate it before syncing' }, { status: 400 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });

  const file = form.get('file');
  const callingListMappingRaw = String(form.get('callingListMapping') ?? '');
  const paymentMappingRaw = String(form.get('paymentMapping') ?? '');

  if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 });
  if (!SUPPORTED_IMPORT_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
    return NextResponse.json({ error: `Unsupported file type — use ${SUPPORTED_IMPORT_EXTENSIONS.join(' or ')}` }, { status: 400 });
  }
  if (!callingListMappingRaw || !paymentMappingRaw) {
    return NextResponse.json({ error: 'Column mapping for both sheets is required — preview the file and confirm both mappings first' }, { status: 400 });
  }
  let callingListMapping: ImportMapping;
  let paymentMapping: SyncPaymentMapping;
  try {
    callingListMapping = JSON.parse(callingListMappingRaw);
    paymentMapping = JSON.parse(paymentMappingRaw);
  } catch {
    return NextResponse.json({ error: 'Invalid column mapping' }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  const created = await prisma.fileSync.create({
    data: {
      fileId: id,
      status: 'queued',
      rawFile: Buffer.from(buffer).toString('base64'),
      rawFileName: file.name,
      callingListMapping: JSON.stringify(callingListMapping),
      paymentMapping: JSON.stringify(paymentMapping),
    },
  });

  return NextResponse.json({ fileSync: { id: created.id, status: 'queued' } }, { status: 201 });
}
