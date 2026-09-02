import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { SUPPORTED_IMPORT_EXTENSIONS, type ImportMapping } from '@/lib/excel';
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
      importWarningCount: f.importWarnings ? (JSON.parse(f.importWarnings) as string[]).length : 0,
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
  const isDistributedImport = String(form.get('isDistributedImport') ?? '') === 'true';
  const sheetPlanRaw = String(form.get('sheetPlan') ?? '');
  const file = form.get('file');

  if (!clientId || !batchLabel || !receivedDateRaw || !(file instanceof File)) {
    return NextResponse.json({ error: 'clientId, batchLabel, receivedDate, and file are required' }, { status: 400 });
  }
  if (!SUPPORTED_IMPORT_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
    return NextResponse.json({ error: `Unsupported file type — use ${SUPPORTED_IMPORT_EXTENSIONS.join(' or ')}` }, { status: 400 });
  }

  if (!mappingRaw) {
    return NextResponse.json({ error: 'Column mapping is required — preview the file and confirm the mapping first' }, { status: 400 });
  }
  let mapping: ImportMapping;
  try {
    mapping = JSON.parse(mappingRaw) as ImportMapping;
  } catch {
    return NextResponse.json({ error: 'Invalid column mapping' }, { status: 400 });
  }

  let sheetPlan: string | null = null;
  if (isDistributedImport) {
    if (!sheetPlanRaw) {
      return NextResponse.json({ error: 'Sheet distribution plan is required — preview the file and confirm each sheet first' }, { status: 400 });
    }
    try {
      JSON.parse(sheetPlanRaw);
    } catch {
      return NextResponse.json({ error: 'Invalid sheet distribution plan' }, { status: 400 });
    }
    sheetPlan = sheetPlanRaw;
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return NextResponse.json({ error: 'Unknown client' }, { status: 400 });

  // Parsing used to happen right here, synchronously — that's what actually timed out a
  // large file: even the *preview* of a 77,217-row .xlsx took minutes on a slow host (see
  // src/lib/excel.ts), and this route was doing a full parse on top of that. So this route
  // now does the minimum: store the raw upload + the mapping already confirmed in the
  // preview step, and mark the file 'queued'. An external cron calls POST /api/worker/tick
  // on a schedule (see .github/workflows/worker-tick.yml), whose first tick for this file
  // does the actual parse, then inserts a chunk at a time exactly as before — see
  // prisma/schema.prisma's File comment for the full sequence.
  const buffer = await file.arrayBuffer();
  const created = await prisma.file.create({
    data: {
      clientId,
      batchLabel,
      receivedDate: new Date(receivedDateRaw),
      isMidMonthTopup,
      importStatus: 'queued',
      rawFile: Buffer.from(buffer).toString('base64'),
      rawFileName: file.name,
      importMapping: JSON.stringify(mapping),
      isDistributedImport,
      sheetPlan,
    },
  });

  return NextResponse.json(
    { file: { id: created.id, batchLabel: created.batchLabel, importStatus: 'queued' } },
    { status: 201 }
  );
}
