import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const debtorId = typeof body?.debtorId === 'string' ? body.debtorId : '';
  const dispositionCode = typeof body?.dispositionCode === 'string' ? body.dispositionCode : '';
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null;
  const promisedAmount = body?.promisedAmount ? Number(body.promisedAmount) : null;
  const promisedDate = typeof body?.promisedDate === 'string' && body.promisedDate ? new Date(body.promisedDate) : null;

  if (!debtorId || !dispositionCode) {
    return NextResponse.json({ error: 'debtorId and dispositionCode are required' }, { status: 400 });
  }

  const code = await prisma.dispositionCode.findUnique({ where: { code: dispositionCode } });
  if (!code) return NextResponse.json({ error: `Unknown disposition code: ${dispositionCode}` }, { status: 400 });

  const debtor = await prisma.debtor.findUnique({ where: { id: debtorId } });
  if (!debtor) return NextResponse.json({ error: 'Debtor not found' }, { status: 404 });
  if (session.role === 'agent' && debtor.assignedAgentId !== session.sub) {
    return NextResponse.json({ error: 'This debtor is not assigned to you' }, { status: 403 });
  }

  const log = await prisma.callLog.create({
    data: {
      debtorId,
      agentId: session.sub,
      dispositionCode,
      note,
      promisedAmount,
      promisedDate,
      syncedAt: new Date(), // written directly, not via the offline queue — see Phase 1 in the gap analysis
    },
    include: { agent: true },
  });

  return NextResponse.json(
    {
      log: {
        id: log.id,
        disposition: log.dispositionCode,
        note: log.note,
        promisedAmount: log.promisedAmount,
        promisedDate: log.promisedDate,
        createdAt: log.createdAt,
        agentName: log.agent.name,
        synced: true,
      },
    },
    { status: 201 }
  );
}
