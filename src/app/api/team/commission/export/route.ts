import { NextResponse } from 'next/server';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { attachmentDisposition } from '@/lib/content-disposition';
import { buildTeamCommissionWorkbook } from '@/lib/excel';
import { getTeamCommission } from '@/lib/team-commission';

export async function GET(req: Request) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const clientId = new URL(req.url).searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  try {
    const commission = await getTeamCommission(clientId);
    if (!commission)
      return NextResponse.json(
        { error: 'Commission tracking is not enabled for this client' },
        { status: 404 }
      );

    const buffer = await buildTeamCommissionWorkbook({
      clientName: commission.clientName,
      totalLoans: commission.totalLoans,
      assignedLoans: commission.assignedLoans,
      buckets: commission.buckets,
      agents: commission.agents,
    });
    return new NextResponse(new Blob([new Uint8Array(buffer)]), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': attachmentDisposition(`${commission.clientName}-commission.xlsx`),
      },
    });
  } catch (error) {
    console.error('Team commission export failed', error);
    return NextResponse.json(
      { error: 'Could not build the commission export — try again or contact IT' },
      { status: 500 }
    );
  }
}
