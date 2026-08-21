import { prisma } from './db';
import { assignByBalanceBand } from './distribution';
import { applyAssignment } from './assignment';

export interface ReassignResult {
  movedCount: number;
  keptCount: number;
  droppedAgentCount: number;
}

/**
 * Redistributes a file across a new agent roster — e.g. going from 3 agents down to 2,
 * or swapping one agent for another. Debtors already assigned to an agent who's still on
 * the new roster are left untouched, so agents staying on don't get needlessly churned;
 * only debtors belonging to a dropped agent (or unassigned) are split across the new
 * roster, by balance band — same algorithm as a fresh distribution. Unlike
 * rebalanceFileForNewAgent (which protects debtors with call history/payments so a new
 * hire only picks up the safest accounts), every debtor whose agent is being dropped has
 * to move regardless of history — there's no "safer" option when their agent is leaving
 * the file entirely, not just making room for someone else.
 */
export async function reassignFile(fileId: string, agentIds: string[]): Promise<ReassignResult> {
  const debtors = await prisma.debtor.findMany({
    where: { fileId },
    select: { id: true, balance: true, assignedAgentId: true },
  });

  const targetSet = new Set(agentIds);
  const toMove = debtors.filter((d) => !d.assignedAgentId || !targetSet.has(d.assignedAgentId));
  const keptCount = debtors.length - toMove.length;

  if (toMove.length === 0) {
    return { movedCount: 0, keptCount, droppedAgentCount: 0 };
  }

  const droppedAgentIds = new Set(
    debtors.map((d) => d.assignedAgentId).filter((agentId): agentId is string => !!agentId && !targetSet.has(agentId))
  );

  const assignment = assignByBalanceBand(toMove, agentIds);
  const reassignedFrom = new Map(toMove.map((d) => [d.id, d.assignedAgentId]));
  await applyAssignment(assignment, reassignedFrom);

  return { movedCount: toMove.length, keptCount, droppedAgentCount: droppedAgentIds.size };
}
