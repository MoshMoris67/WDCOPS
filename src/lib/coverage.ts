import { prisma } from './db';

export interface AgentWeight {
  id: string;
  weight: number;
}

const MIN_COVERAGE_WEIGHT = 0.1;

/**
 * Coverage = the fraction of an agent's currently-assigned debtors on this
 * client that have at least one call logged against them. An agent who's
 * behind on their existing list (low coverage) gets a light weight here so
 * incoming new accounts don't pile onto a backlog they haven't worked
 * through yet; an agent with nothing assigned to this client yet defaults to
 * full weight — no backlog to protect them from, so they're fully available.
 * Never zero, even at 0% coverage — falling behind isn't a reason to stop
 * getting any new work at all, just less of it.
 */
export async function agentCoverageWeights(clientId: string, agentIds: string[]): Promise<AgentWeight[]> {
  if (agentIds.length === 0) return [];

  const debtors = await prisma.debtor.findMany({
    where: { file: { clientId }, assignedAgentId: { in: agentIds } },
    select: { assignedAgentId: true, callLogs: { select: { id: true }, take: 1 } },
  });

  const byAgent = new Map<string, { total: number; contacted: number }>();
  for (const id of agentIds) byAgent.set(id, { total: 0, contacted: 0 });
  for (const d of debtors) {
    const stat = byAgent.get(d.assignedAgentId!);
    if (!stat) continue;
    stat.total++;
    if (d.callLogs.length > 0) stat.contacted++;
  }

  return agentIds.map((id) => {
    const stat = byAgent.get(id)!;
    const coverage = stat.total > 0 ? stat.contacted / stat.total : 1;
    return { id, weight: Math.max(coverage, MIN_COVERAGE_WEIGHT) };
  });
}
