import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { rebalanceFileForNewAgent } from '@/lib/rebalance';

/** Brings an agent (typically a new hire) into a file that's already fully distributed — see lib/rebalance.ts for the priority rules. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const newAgentId = typeof body?.newAgentId === 'string' ? body.newAgentId : '';
  if (!newAgentId) return NextResponse.json({ error: 'newAgentId is required' }, { status: 400 });

  const [file, agent] = await Promise.all([
    prisma.file.findUnique({ where: { id }, select: { id: true } }),
    prisma.user.findUnique({ where: { id: newAgentId } }),
  ]);
  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });
  if (!agent || !['agent', 'admin'].includes(agent.role) || agent.status !== 'active') {
    return NextResponse.json({ error: 'Target user is not an active agent' }, { status: 400 });
  }

  const result = await rebalanceFileForNewAgent(id, newAgentId);

  if (result.reassignedCount === 0) {
    return NextResponse.json({
      ...result,
      message: result.startingCount >= result.targetCount
        ? `${agent.name} already has a fair share on this file — nothing to move.`
        : 'No eligible debtors to reassign — every remaining account already has collections against it.',
    });
  }

  return NextResponse.json({
    ...result,
    message: `Moved ${result.reassignedCount} debtor(s) to ${agent.name} (${result.neverCalledCount} never called, ${result.noCollectionsCount} called with no collections)${result.shortfall ? ' — could not reach a full fair share without touching accounts with collections' : ''}.`,
  });
}
