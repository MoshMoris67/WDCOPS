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

  // Prisma's default transaction timeout is 5s — comfortably enough for a small file, but
  // a full-file distribution across tens of thousands of debtors on a resource-constrained
  // self-hosted Postgres can exceed that, rolling back every updateMany and every
  // Assignment row silently: the caller sees a network/500 error, but if that error isn't
  // clearly surfaced, admin and agent alike can be left thinking a distribution "took" when
  // nothing was persisted. The array (batch) form of $transaction only accepts
  // isolationLevel, not timeout, so this uses the interactive callback form instead.
  await prisma.$transaction(
    async (tx) => {
      for (const [agentId, debtorIds] of debtorIdsByAgent) {
        await tx.debtor.updateMany({ where: { id: { in: debtorIds } }, data: { assignedAgentId: agentId } });
      }
      await tx.assignment.createMany({
        data: [...assignment.entries()].map(([debtorId, agentId]) => ({
          debtorId,
          agentId,
          reassignedFromId: reassignedFrom?.get(debtorId) ?? null,
        })),
      });
    },
    { timeout: 60_000 }
  );
}
