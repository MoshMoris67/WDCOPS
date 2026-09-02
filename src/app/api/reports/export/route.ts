import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { buildReportSummary } from '@/lib/reports';
import { buildReportWorkbook } from '@/lib/excel';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId') ?? '';
  const frequency = searchParams.get('frequency') ?? 'daily';
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const agentId = searchParams.get('agentId') || undefined;

  if (!clientId || !from || !to) {
    return NextResponse.json({ error: 'clientId, from, and to are required' }, { status: 400 });
  }

  let summary;
  try {
    summary = await buildReportSummary(clientId, new Date(`${from}T00:00:00`), new Date(`${to}T23:59:59`), agentId);
  } catch {
    return NextResponse.json({ error: 'Unknown client' }, { status: 404 });
  }

  const buffer = await buildReportWorkbook({
    clientName: summary.clientName,
    frequency,
    from,
    to,
    commentSummary: summary.commentSummary,
    debtorReport: summary.debtorReport,
    agents: summary.agentSummary,
  });

  const agentSuffix = agentId ? `-${(await prisma.user.findUnique({ where: { id: agentId }, select: { name: true } }))?.name ?? 'agent'}` : '';
  const filename = `${summary.clientName}-${frequency}-${from}-to-${to}${agentSuffix}.xlsx`;
  return new NextResponse(new Blob([new Uint8Array(buffer)]), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
