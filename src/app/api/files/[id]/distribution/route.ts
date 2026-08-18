import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { bandForBalance, BALANCE_BANDS } from '@/lib/distribution';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id } = await params;
  const debtors = await prisma.debtor.findMany({
    where: { fileId: id, assignedAgentId: { not: null } },
    include: { assignedAgent: true },
  });

  const byAgent = new Map<string, { agentId: string; agentName: string; counts: Record<string, number> }>();
  for (const d of debtors) {
    const agentId = d.assignedAgentId!;
    if (!byAgent.has(agentId)) {
      byAgent.set(agentId, {
        agentId,
        agentName: d.assignedAgent!.name,
        counts: Object.fromEntries(BALANCE_BANDS.map((b) => [b.key, 0])),
      });
    }
    byAgent.get(agentId)!.counts[bandForBalance(d.balance)]++;
  }

  const rows = [...byAgent.values()].map((row) => ({
    agentId: row.agentId,
    agentName: row.agentName,
    ...row.counts,
    total: Object.values(row.counts).reduce((s, n) => s + n, 0),
  }));

  return NextResponse.json({ distribution: rows });
}
