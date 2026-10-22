import { prisma } from './db';
import { BUCKET_LABELS, BUCKET_ORDER, type CanonicalBucket } from './commission';

export interface TeamCommissionBucketRow {
  bucket: string;
  label: string;
  loans: number;
  collections: number;
  companyCommission: number;
  agentCommission: number;
}

export interface TeamCommissionAgentRow {
  agentId: string;
  agentName: string;
  loans: number;
  collections: number;
  companyCommission: number;
  agentCommission: number;
}

export interface TeamCommission {
  clientId: string;
  clientName: string;
  totalLoans: number;
  assignedLoans: number;
  buckets: TeamCommissionBucketRow[];
  agents: TeamCommissionAgentRow[];
}

export async function getTeamCommission(clientId: string): Promise<TeamCommission | null> {
  const [client, rateCount] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { name: true } }),
    prisma.commissionRate.count({ where: { clientId } }),
  ]);
  if (!client) return null;
  if (rateCount === 0) return null;

  const entries = await prisma.reconciliationEntry.findMany({
    where: { bucket: { not: null }, reconciliation: { clientId } },
    select: {
      bucket: true,
      paidAmount: true,
      companyCommission: true,
      agentCommission: true,
      debtor: { select: { assignedAgentId: true, loanRef: true } },
    },
  });

  const byBucket = new Map<string, TeamCommissionBucketRow>();
  const byAgent = new Map<string, TeamCommissionAgentRow>();
  const loanRefsByBucket = new Map<string, Set<string>>();
  const loanRefsByAgent = new Map<string, Set<string>>();
  const allLoanRefs = new Set<string>();
  const assignedLoanRefs = new Set<string>();
  const agentIds = new Set<string>();

  for (const entry of entries) {
    const bucket = entry.bucket as CanonicalBucket;
    allLoanRefs.add(entry.debtor.loanRef);
    const bucketRow = byBucket.get(bucket) ?? {
      bucket,
      label: BUCKET_LABELS[bucket] ?? bucket,
      loans: 0,
      collections: 0,
      companyCommission: 0,
      agentCommission: 0,
    };
    const bucketLoanRefs = loanRefsByBucket.get(bucket) ?? new Set<string>();
    bucketLoanRefs.add(entry.debtor.loanRef);
    loanRefsByBucket.set(bucket, bucketLoanRefs);
    bucketRow.collections += entry.paidAmount;
    bucketRow.companyCommission += entry.companyCommission ?? 0;
    bucketRow.agentCommission += entry.agentCommission ?? 0;
    byBucket.set(bucket, bucketRow);

    const agentId = entry.debtor.assignedAgentId;
    if (!agentId) continue;

    assignedLoanRefs.add(entry.debtor.loanRef);
    agentIds.add(agentId);
    const agentRow = byAgent.get(agentId) ?? {
      agentId,
      agentName: '',
      loans: 0,
      collections: 0,
      companyCommission: 0,
      agentCommission: 0,
    };
    const agentLoanRefs = loanRefsByAgent.get(agentId) ?? new Set<string>();
    agentLoanRefs.add(entry.debtor.loanRef);
    loanRefsByAgent.set(agentId, agentLoanRefs);
    agentRow.collections += entry.paidAmount;
    agentRow.companyCommission += entry.companyCommission ?? 0;
    agentRow.agentCommission += entry.agentCommission ?? 0;
    byAgent.set(agentId, agentRow);
  }

  const users =
    agentIds.size > 0
      ? await prisma.user.findMany({
          where: { id: { in: [...agentIds] } },
          select: { id: true, name: true },
        })
      : [];
  const nameById = new Map(users.map((user) => [user.id, user.name]));
  for (const agent of byAgent.values()) agent.agentName = nameById.get(agent.agentId) ?? 'Unknown';
  for (const [bucket, row] of byBucket) row.loans = loanRefsByBucket.get(bucket)?.size ?? 0;
  for (const [agentId, row] of byAgent) row.loans = loanRefsByAgent.get(agentId)?.size ?? 0;

  return {
    clientId,
    clientName: client.name,
    totalLoans: allLoanRefs.size,
    assignedLoans: assignedLoanRefs.size,
    buckets: BUCKET_ORDER.map((key) => byBucket.get(key)).filter(
      (row): row is TeamCommissionBucketRow => !!row
    ),
    agents: [...byAgent.values()].sort((a, b) => b.collections - a.collections),
  };
}
