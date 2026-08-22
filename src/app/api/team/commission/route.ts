import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { BUCKET_ORDER, BUCKET_LABELS, type CanonicalBucket } from '@/lib/commission';

interface BucketRow {
  bucket: string;
  label: string;
  loans: number;
  collections: number;
  companyCommission: number;
  agentCommission: number;
}

interface AgentRow {
  agentId: string;
  agentName: string;
  loans: number;
  collections: number;
  companyCommission: number;
  agentCommission: number;
}

/**
 * Per-bucket and per-agent commission rollups for one client — the numbers behind the
 * "Commission — {client}" card on Team Dashboard. Only meaningful for a client with
 * CommissionRate rows configured (see lib/commission.ts); returns empty otherwise, so the
 * frontend can hide the card entirely for every other client with a single check.
 *
 * Agent credit is joined off the debtor's CURRENT assignment, same as
 * getFileAgentRecoveredAggregates (lib/debtor-aggregates.ts) already does for the
 * existing "Agent Performance by File" table — consistent with how the rest of the app
 * already treats "whoever owns this debtor now" as the attribution, not a point-in-time
 * snapshot of who owned it when the commission was actually earned.
 */
export async function GET(req: Request) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const clientId = new URL(req.url).searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  const rateCount = await prisma.commissionRate.count({ where: { clientId } });
  if (rateCount === 0) {
    return NextResponse.json({ enabled: false, buckets: [], agents: [] });
  }

  const entries = await prisma.reconciliationEntry.findMany({
    where: { bucket: { not: null }, reconciliation: { clientId } },
    select: {
      bucket: true,
      paidAmount: true,
      companyCommission: true,
      agentCommission: true,
      debtor: { select: { assignedAgentId: true } },
    },
  });

  const byBucket = new Map<string, BucketRow>();
  const byAgent = new Map<string, AgentRow>();
  const agentIds = new Set<string>();

  for (const e of entries) {
    const bucket = e.bucket as CanonicalBucket;
    const b = byBucket.get(bucket) ?? { bucket, label: BUCKET_LABELS[bucket] ?? bucket, loans: 0, collections: 0, companyCommission: 0, agentCommission: 0 };
    b.loans += 1;
    b.collections += e.paidAmount;
    b.companyCommission += e.companyCommission ?? 0;
    b.agentCommission += e.agentCommission ?? 0;
    byBucket.set(bucket, b);

    const agentId = e.debtor.assignedAgentId;
    if (agentId) {
      agentIds.add(agentId);
      const a = byAgent.get(agentId) ?? { agentId, agentName: '', loans: 0, collections: 0, companyCommission: 0, agentCommission: 0 };
      a.loans += 1;
      a.collections += e.paidAmount;
      a.companyCommission += e.companyCommission ?? 0;
      a.agentCommission += e.agentCommission ?? 0;
      byAgent.set(agentId, a);
    }
  }

  const agentUsers = agentIds.size > 0
    ? await prisma.user.findMany({ where: { id: { in: [...agentIds] } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(agentUsers.map((u) => [u.id, u.name]));
  for (const a of byAgent.values()) a.agentName = nameById.get(a.agentId) ?? 'Unknown';

  const buckets = BUCKET_ORDER.map((k) => byBucket.get(k)).filter((b): b is BucketRow => !!b);
  const agents = [...byAgent.values()].sort((a, b) => b.collections - a.collections);

  return NextResponse.json({ enabled: true, buckets, agents });
}
