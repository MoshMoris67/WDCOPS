import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { computeDebtorStatus } from '@/lib/debtor-status';

async function loadDebtor(id: string) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return prisma.debtor.findUnique({
    where: { id },
    include: {
      file: { include: { client: true } },
      assignedAgent: true,
      callLogs: { orderBy: { createdAt: 'desc' }, include: { agent: true } },
      reconciliationEntries: { where: { createdAt: { gte: sevenDaysAgo } }, take: 1 },
    },
  });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id } = await params;
  const debtor = await loadDebtor(id);

  if (!debtor) return NextResponse.json({ error: 'Debtor not found' }, { status: 404 });
  if (session.role === 'agent' && debtor.assignedAgentId !== session.sub) {
    return NextResponse.json({ error: 'This debtor is not assigned to you' }, { status: 403 });
  }

  const status = computeDebtorStatus(debtor.callLogs);

  return NextResponse.json({
    debtor: {
      id: debtor.id,
      name: debtor.name,
      phone1: debtor.phone1,
      phone2: debtor.phone2,
      loanRef: debtor.loanRef,
      client: debtor.file.client.name,
      amountOwed: debtor.amountOwed,
      cumulativePaid: debtor.cumulativePaid,
      balance: debtor.balance,
      assignedAgentId: debtor.assignedAgentId,
      assignedAgent: debtor.assignedAgent?.name ?? null,
      branch: debtor.branch,
      recentlyPaid: debtor.reconciliationEntries.length > 0,
      ...status,
    },
    callHistory: debtor.callLogs.map((log) => ({
      id: log.id,
      disposition: log.dispositionCode,
      note: log.note,
      promisedAmount: log.promisedAmount,
      promisedDate: log.promisedDate,
      createdAt: log.createdAt,
      agentName: log.agent.name,
      synced: log.syncedAt !== null,
    })),
  });
}

/** Reassigns a debtor to a different agent — §8's "if an agent leaves mid-file, their debtors transfer" and §4's Team Leader "reassign debtors". Call history stays put since it belongs to the debtor, not the assignment. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const newAgentId = typeof body?.assignedAgentId === 'string' ? body.assignedAgentId : '';
  if (!newAgentId) return NextResponse.json({ error: 'assignedAgentId is required' }, { status: 400 });

  const [debtor, agent] = await Promise.all([
    prisma.debtor.findUnique({ where: { id } }),
    prisma.user.findUnique({ where: { id: newAgentId } }),
  ]);
  if (!debtor) return NextResponse.json({ error: 'Debtor not found' }, { status: 404 });
  if (!agent || !['agent', 'admin'].includes(agent.role)) return NextResponse.json({ error: 'Target user is not an agent' }, { status: 400 });

  await prisma.$transaction([
    prisma.debtor.update({ where: { id }, data: { assignedAgentId: newAgentId } }),
    prisma.assignment.create({
      data: { debtorId: id, agentId: newAgentId, reassignedFromId: debtor.assignedAgentId },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
