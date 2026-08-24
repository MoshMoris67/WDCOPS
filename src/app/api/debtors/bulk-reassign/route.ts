import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';

// Same ceiling used for the file-delete fix — a single query's IN (...) clause can't
// exceed Postgres's ~32,767 bind-parameter limit, and a bulk reassign of a whole large
// file is exactly the scale where that bites.
const CHUNK_SIZE = 5000;

/** Moves any number of specific debtors to one agent in a single action — the bulk
 *  counterpart to PATCH /api/debtors/[id]. Built for "move 1,000 of this file's 5,000
 *  debtors to someone else" without an admin clicking Reassign one row at a time. Same
 *  audit trail as the single-debtor version (an Assignment row per debtor, noting who it
 *  moved from); debtors already on the target agent are silently skipped rather than
 *  creating a no-op audit entry. */
export async function POST(req: Request) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const body = await req.json().catch(() => null);
  const debtorIds: string[] = Array.isArray(body?.debtorIds)
    ? body.debtorIds.filter((v: unknown): v is string => typeof v === 'string')
    : [];
  const assignedAgentId = typeof body?.assignedAgentId === 'string' ? body.assignedAgentId : '';

  if (debtorIds.length === 0) return NextResponse.json({ error: 'debtorIds is required' }, { status: 400 });
  if (!assignedAgentId) return NextResponse.json({ error: 'assignedAgentId is required' }, { status: 400 });

  const agent = await prisma.user.findUnique({ where: { id: assignedAgentId } });
  if (!agent || !['agent', 'admin'].includes(agent.role) || agent.status !== 'active') {
    return NextResponse.json({ error: 'Target user is not an active agent' }, { status: 400 });
  }

  const debtors = await prisma.debtor.findMany({
    where: { id: { in: debtorIds } },
    select: { id: true, assignedAgentId: true },
  });
  const toMove = debtors.filter((d) => d.assignedAgentId !== assignedAgentId);

  if (toMove.length === 0) {
    return NextResponse.json({ movedCount: 0, alreadyAssignedCount: debtors.length });
  }

  const chunks: string[][] = [];
  for (let i = 0; i < toMove.length; i += CHUNK_SIZE) {
    chunks.push(toMove.slice(i, i + CHUNK_SIZE).map((d) => d.id));
  }

  // Interactive transaction (not the array/batch form) so a 120s timeout can be set —
  // see lib/assignment.ts and lib/rebalance.ts for the same reasoning: Prisma's 5s batch
  // default is comfortably exceeded once this runs against real thousands-of-debtors scale.
  await prisma.$transaction(
    async (tx) => {
      for (const chunk of chunks) {
        await tx.debtor.updateMany({ where: { id: { in: chunk } }, data: { assignedAgentId } });
      }
      await tx.assignment.createMany({
        data: toMove.map((d) => ({ debtorId: d.id, agentId: assignedAgentId, reassignedFromId: d.assignedAgentId })),
      });
    },
    { timeout: 120_000 }
  );

  return NextResponse.json({ movedCount: toMove.length, alreadyAssignedCount: debtors.length - toMove.length });
}
