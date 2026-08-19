import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { loadTable, parseImportRows, suggestImportMapping, SUPPORTED_IMPORT_EXTENSIONS, type ImportMapping } from '@/lib/excel';
import { getFileDebtorAggregates, getAgentsAllocatedCounts } from '@/lib/debtor-aggregates';

function fileStatus(f: { isRecalled: boolean; debtorCount: number; assignedCount: number }) {
  if (f.isRecalled) return 'recalled';
  if (f.debtorCount === 0 || f.assignedCount === 0) return 'pending';
  if (f.assignedCount < f.debtorCount) return 'distributing';
  return 'active';
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const files = await prisma.file.findMany({
    include: { client: true },
    orderBy: { receivedDate: 'desc' },
  });
  const fileIds = files.map((f) => f.id);

  const [aggregates, agentsAllocated] = await Promise.all([
    getFileDebtorAggregates(fileIds),
    getAgentsAllocatedCounts(fileIds),
  ]);

  const result = files.map((f) => {
    const agg = aggregates.get(f.id) ?? { debtorCount: 0, assignedCount: 0, totalBalance: 0, recovered: 0, totalOwed: 0 };
    const { debtorCount, assignedCount, totalBalance } = agg;
    return {
      id: f.id,
      clientId: f.clientId,
      client: f.client.name,
      batchLabel: f.batchLabel,
      receivedDate: f.receivedDate,
      isMidMonthTopup: f.isMidMonthTopup,
      debtorCount,
      assignedCount,
      totalBalance,
      agentsAllocated: agentsAllocated.get(f.id) ?? 0,
      status: fileStatus({ isRecalled: f.isRecalled, debtorCount, assignedCount }),
      importStatus: f.importStatus,
      importError: f.importError,
    };
  });

  return NextResponse.json({ files: result });
}

export async function POST(req: Request) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });

  const clientId = String(form.get('clientId') ?? '');
  const batchLabel = String(form.get('batchLabel') ?? '').trim();
  const receivedDateRaw = String(form.get('receivedDate') ?? '');
  const isMidMonthTopup = String(form.get('isMidMonthTopup') ?? '') === 'true';
  const mappingRaw = String(form.get('mapping') ?? '');
  const file = form.get('file');

  if (!clientId || !batchLabel || !receivedDateRaw || !(file instanceof File)) {
    return NextResponse.json({ error: 'clientId, batchLabel, receivedDate, and file are required' }, { status: 400 });
  }
  if (!SUPPORTED_IMPORT_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
    return NextResponse.json({ error: `Unsupported file type — use ${SUPPORTED_IMPORT_EXTENSIONS.join(' or ')}` }, { status: 400 });
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return NextResponse.json({ error: 'Unknown client' }, { status: 400 });

  const buffer = await file.arrayBuffer();
  const table = await loadTable(buffer, file.name);
  // A mapping confirmed in the import modal (or sent by any other caller) wins outright —
  // auto-detection is only the fallback for a caller that skips that step entirely.
  let mapping: ImportMapping;
  try {
    mapping = mappingRaw ? (JSON.parse(mappingRaw) as ImportMapping) : suggestImportMapping(table[0] ?? []);
  } catch {
    return NextResponse.json({ error: 'Invalid column mapping' }, { status: 400 });
  }
  const { rows, errors } = parseImportRows(table, mapping);

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No valid debtor rows found in the file', details: errors }, { status: 400 });
  }

  const created = await prisma.file.create({
    data: {
      clientId,
      batchLabel,
      receivedDate: new Date(receivedDateRaw),
      isMidMonthTopup,
      importStatus: 'processing',
    },
  });

  // Deliberately not awaited: the row insert is what was timing out on a slow host for
  // a large file (a nested file.create({data:{debtors:{create:[...]}}}) would be one
  // INSERT per debtor — createMany batches it into one, but even one bulk statement over
  // tens of thousands of rows can take longer than a proxy's request timeout allows). By
  // not awaiting this, the HTTP response below goes out immediately regardless of file
  // size, and this continues running because the app runs as a real persistent Node
  // process here (Render), not a serverless function that would freeze the moment the
  // response is sent — this exact pattern would silently stop mid-way on a serverless host.
  createMany(created.id, rows).catch(() => {});

  return NextResponse.json(
    {
      file: { id: created.id, batchLabel: created.batchLabel, debtorCount: rows.length, importStatus: 'processing' },
      warnings: errors,
    },
    { status: 201 }
  );
}

async function createMany(fileId: string, rows: ReturnType<typeof parseImportRows>['rows']) {
  try {
    await prisma.debtor.createMany({
      data: rows.map((r) => {
        // Some clients' files carry the current outstanding balance separately from the
        // original amount owed (already-partly-repaid loans) — when they don't, balance
        // defaults to amountOwed, matching the standard-template behavior.
        const balance = r.balance ?? r.amountOwed;
        const cumulativePaid = Math.max(0, r.amountOwed - balance);
        return {
          fileId,
          name: r.name,
          phone1: r.phone1,
          phone2: r.phone2,
          loanRef: r.loanRef,
          amountOwed: r.amountOwed,
          cumulativePaid,
          balance,
        };
      }),
    });
    await prisma.file.update({ where: { id: fileId }, data: { importStatus: 'complete' } });
  } catch (err) {
    await prisma.file.update({
      where: { id: fileId },
      data: { importStatus: 'failed', importError: err instanceof Error ? err.message : 'Import failed' },
    }).catch(() => {});
  }
}
