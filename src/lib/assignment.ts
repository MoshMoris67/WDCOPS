import { prisma } from './db';

/**
 * Writes a debtor→agent assignment map to the database. Groups debtor ids by
 * target agent and issues one `updateMany` per agent instead of one `update`
 * per debtor — for a file with tens of thousands of debtors split across a
 * handful of agents, that's the difference between a handful of statements
 * and tens of thousands of them (the same class of slowdown fixed in file
 * import — see api/files/route.ts).
 */
export async function applyAssignment(
  assignment: Map<string, string>,
  reassignedFrom?: Map<string, string | null>
): Promise<void> {
  if (assignment.size === 0) return;

  const debtorIdsByAgent = new Map<string, string[]>();
  for (const [debtorId, agentId] of assignment) {
    if (!debtorIdsByAgent.has(agentId)) debtorIdsByAgent.set(agentId, []);
    debtorIdsByAgent.get(agentId)!.push(debtorId);
  }

  await prisma.$transaction([
    ...[...debtorIdsByAgent.entries()].map(([agentId, debtorIds]) =>
      prisma.debtor.updateMany({ where: { id: { in: debtorIds } }, data: { assignedAgentId: agentId } })
    ),
    prisma.assignment.createMany({
      data: [...assignment.entries()].map(([debtorId, agentId]) => ({
        debtorId,
        agentId,
        reassignedFromId: reassignedFrom?.get(debtorId) ?? null,
      })),
    }),
  ]);
}
