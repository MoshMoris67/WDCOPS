import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { buildReportSummary } from '@/lib/reports';
import { buildReportWorkbook } from '@/lib/excel';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId') ?? '';
  const frequency = searchParams.get('frequency') ?? 'daily';
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  if (!clientId || !from || !to) {
    return NextResponse.json({ error: 'clientId, from, and to are required' }, { status: 400 });
  }

  let summary;
  try {
    summary = await buildReportSummary(clientId, new Date(`${from}T00:00:00`), new Date(`${to}T23:59:59`));
  } catch {
    return NextResponse.json({ error: 'Unknown client' }, { status: 404 });
  }

  const recoveryPct = summary.totalOwed > 0 ? Math.round((summary.recovered / summary.totalOwed) * 100) : 0;
  const contactRate = summary.totalDebtors > 0 ? Math.round((summary.contacted / summary.totalDebtors) * 100) : 0;

  const buffer = await buildReportWorkbook({
    clientName: summary.clientName,
    frequency,
    from,
    to,
    summary: [
      { label: 'Total Debtors', value: summary.totalDebtors },
      { label: 'Contacted', value: summary.contacted },
      { label: 'Contact Rate', value: `${contactRate}%` },
      { label: 'PTP Count', value: summary.ptpCount },
      { label: 'PTP Amount (UGX)', value: summary.ptpAmount },
      { label: 'Total Owed (UGX)', value: summary.totalOwed },
      { label: 'Recovered (UGX)', value: summary.recovered },
      { label: 'Recovery Rate', value: `${recoveryPct}%` },
      { label: 'Stale Accounts (5+ NA)', value: summary.staleCount },
    ],
    dispositions: summary.dispositions,
    agents: summary.agentSummary,
  });

  const filename = `${summary.clientName}-${frequency}-${from}-to-${to}.xlsx`;
  return new NextResponse(new Blob([new Uint8Array(buffer)]), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
