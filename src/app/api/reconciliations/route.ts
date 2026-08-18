import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { parseReconciliationWorkbook, SUPPORTED_IMPORT_EXTENSIONS } from '@/lib/excel';
import { processReconciliation } from '@/lib/reconciliation';

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
  const file = form.get('file');

  if (!clientId || (type !== 'full' && type !== 'partial') || !receivedDate || !(file instanceof File)) {
    return NextResponse.json({ error: 'clientId, reconciliationType, receivedDate, and file are required' }, { status: 400 });
  }
  if (!SUPPORTED_IMPORT_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
    return NextResponse.json({ error: `Unsupported file type — use ${SUPPORTED_IMPORT_EXTENSIONS.join(' or ')}` }, { status: 400 });
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return NextResponse.json({ error: 'Unknown client' }, { status: 400 });

  const buffer = await file.arrayBuffer();
  const { rows, errors: parseErrors } = await parseReconciliationWorkbook(buffer, type, file.name);

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No valid rows found in the file', details: parseErrors }, { status: 400 });
  }

  const reconciliation = await prisma.reconciliation.create({
    data: {
      clientId,
      fileId,
      type,
      receivedAt: new Date(`${receivedDate}T${receivedTime}`),
      recordCount: rows.length,
      notes,
      rawRows: JSON.stringify(rows),
      status: 'pending',
    },
  });

  const result = await processReconciliation(reconciliation.id, clientId, type, rows);

  const updated = await prisma.reconciliation.update({
    where: { id: reconciliation.id },
    data: {
      status: result.status,
      updatedCount: result.updatedCount,
      newAccountsCount: result.newAccountsCount,
      totalUpdated: result.totalUpdated,
      errorSummary: result.errorSummary,
      processedAt: new Date(),
    },
  });

  return NextResponse.json(
    {
      reconciliation: {
        id: updated.id,
        status: updated.status,
        updatedCount: updated.updatedCount,
        newAccountsCount: updated.newAccountsCount,
      },
      warnings: [...parseErrors, ...(result.errorSummary ? [result.errorSummary] : [])],
    },
    { status: 201 }
  );
}
