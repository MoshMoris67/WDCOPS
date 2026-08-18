import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { assignByBalanceBand } from '@/lib/distribution';
import { applyAssignment } from '@/lib/assignment';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const requestedAgentIds: string[] | null = Array.isArray(body?.agentIds) && body.agentIds.length > 0 ? body.agentIds : null;

  const unassigned = await prisma.debtor.findMany({
    where: { fileId: id, assignedAgentId: null },
    select: { id: true, balance: true },
  });
  if (unassigned.length === 0) {
    return NextResponse.json({ error: 'No unassigned debtors on this file' }, { status: 400 });
  }

  // Falls back to every active agent when the caller doesn't hand-pick a roster —
  // keeps this endpoint usable without the UI's agent picker too. An explicit roster
  // (from the picker) may also include admins — some admins take calls too, but only
  // when someone deliberately puts them on the list for that file, not by default.
  const agents = await prisma.user.findMany({
    where: requestedAgentIds
      ? { status: 'active', role: { in: ['agent', 'admin'] }, id: { in: requestedAgentIds } }
      : { status: 'active', role: 'agent' },
    select: { id: true },
    orderBy: { name: 'asc' },
  });
  if (agents.length === 0) {
    return NextResponse.json({ error: 'No active agents to distribute to' }, { status: 400 });
  }
  if (requestedAgentIds && agents.length !== requestedAgentIds.length) {
    return NextResponse.json({ error: 'One or more selected agents are not active agents' }, { status: 400 });
  }

  const assignment = assignByBalanceBand(unassigned, agents.map((a) => a.id));
  await applyAssignment(assignment);

  return NextResponse.json({ assignedCount: assignment.size, agentsUsed: agents.length });
}
