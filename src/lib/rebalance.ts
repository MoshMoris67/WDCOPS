import { prisma } from './db';

export interface RebalanceResult {
  reassignedCount: number;
  neverCalledCount: number;
  noCollectionsCount: number;
  targetCount: number;
  startingCount: number;
  shortfall: boolean;
}

interface Candidate {
  id: string;
  assignedAgentId: string;
}

/**
 * Brings a new agent into a file that's already been fully distributed —
 * §8's "if an agent leaves mid-file, their debtors transfer automatically",
 * run in reverse for an agent joining. Never puts two agents on the same
 * debtor (one debtor per file = one agent, always — this only ever moves
 * ownership, never copies it).
 *
 * Priority for which debtors move, safest first:
 *   1. Never called at all (no CallLog) — no relationship to disrupt yet.
 *   2. Called, but nothing collected (cumulativePaid === 0) — no progress at risk.
 * Debtors with any payment recorded are never touched.
 *
 * Within each category, debtors are pulled one at a time from whichever
 * agent currently holds the most overall (by count), so the new agent's
 * pickup also levels out the existing roster rather than just topping
 * itself up off one unlucky agent.
 */
export async function rebalanceFileForNewAgent(fileId: string, newAgentId: string): Promise<RebalanceResult> {
  const debtors = await prisma.debtor.findMany({
    where: { fileId },
    select: { id: true, assignedAgentId: true, cumulativePaid: true, callLogs: { select: { id: true }, take: 1 } },
  });

  const totalCountByAgent = new Map<string, number>();
  for (const d of debtors) {
    if (!d.assignedAgentId) continue;
    totalCountByAgent.set(d.assignedAgentId, (totalCountByAgent.get(d.assignedAgentId) ?? 0) + 1);
  }
  const startingCount = totalCountByAgent.get(newAgentId) ?? 0;
  const otherAgentCount = new Set([...totalCountByAgent.keys()].filter((id) => id !== newAgentId)).size;
  const agentCountAfter = otherAgentCount + (startingCount > 0 ? 0 : 1);
  const targetCount = agentCountAfter > 0 ? Math.round(debtors.length / agentCountAfter) : 0;

  function pull(pool: Candidate[], remaining: number): { debtorId: string; fromAgentId: string }[] {
    const byAgent = new Map<string, Candidate[]>();
    for (const d of pool) {
      if (!byAgent.has(d.assignedAgentId)) byAgent.set(d.assignedAgentId, []);
      byAgent.get(d.assignedAgentId)!.push(d);
    }
    const moves: { debtorId: string; fromAgentId: string }[] = [];
    while (moves.length < remaining) {
      let donorId: string | null = null;
      let donorTotal = -1;
      for (const [agentId, list] of byAgent) {
        if (list.length === 0) continue;
        const total = totalCountByAgent.get(agentId) ?? 0;
        if (total > donorTotal) {
          donorTotal = total;
          donorId = agentId;
        }
      }
      if (!donorId) break; // this category is exhausted
      const debtor = byAgent.get(donorId)!.pop()!;
      moves.push({ debtorId: debtor.id, fromAgentId: donorId });
      totalCountByAgent.set(donorId, (totalCountByAgent.get(donorId) ?? 0) - 1);
      totalCountByAgent.set(newAgentId, (totalCountByAgent.get(newAgentId) ?? 0) + 1);
    }
    return moves;
  }

  const needed = () => Math.max(0, targetCount - (totalCountByAgent.get(newAgentId) ?? 0));

  const neverCalledPool: Candidate[] = debtors
    .filter((d) => d.assignedAgentId && d.assignedAgentId !== newAgentId && d.callLogs.length === 0)
    .map((d) => ({ id: d.id, assignedAgentId: d.assignedAgentId! }));
  const neverCalledMoves = pull(neverCalledPool, needed());

  const movedIds = new Set(neverCalledMoves.map((m) => m.debtorId));
  const noCollectionsPool: Candidate[] = debtors
    .filter((d) => d.assignedAgentId && d.assignedAgentId !== newAgentId && !movedIds.has(d.id) && d.callLogs.length > 0 && d.cumulativePaid === 0)
    .map((d) => ({ id: d.id, assignedAgentId: d.assignedAgentId! }));
  const noCollectionsMoves = pull(noCollectionsPool, needed());

  const allMoves = [...neverCalledMoves, ...noCollectionsMoves];

  if (allMoves.length > 0) {
    // Every move here lands on the same newAgentId, so this is one updateMany — not
    // one update per debtor (see lib/assignment.ts for the multi-target version used
    // by initial distribution, where different debtors go to different agents).
    // Custom timeout for the same reason as applyAssignment (lib/assignment.ts) — a big
    // file's worth of moves can outrun Prisma's 5s default on a resource-constrained
    // self-hosted Postgres, rolling everything back silently. The array (batch) form of
    // $transaction only accepts isolationLevel, not timeout, so this uses the interactive
    // callback form instead.
    await prisma.$transaction(
      async (tx) => {
        await tx.debtor.updateMany({ where: { id: { in: allMoves.map((m) => m.debtorId) } }, data: { assignedAgentId: newAgentId } });
        await tx.assignment.createMany({
          data: allMoves.map((m) => ({ debtorId: m.debtorId, agentId: newAgentId, reassignedFromId: m.fromAgentId })),
        });
      },
      { timeout: 60_000 }
    );
  }

  return {
    reassignedCount: allMoves.length,
    neverCalledCount: neverCalledMoves.length,
    noCollectionsCount: noCollectionsMoves.length,
    targetCount,
    startingCount,
    shortfall: needed() > 0,
  };
}
