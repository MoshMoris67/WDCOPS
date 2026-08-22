import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { BALANCE_BANDS, type BandKey } from '@/lib/distribution';

// One numeric range per band — kept in sync with lib/distribution.ts's bandForBalance,
// which this route used to replicate in JS after fetching every debtor row (including the
// full joined agent row) for the file. For a file with tens of thousands of assigned
// debtors that's the same unbounded-fetch anti-pattern already fixed for file import and
// reconciliation processing elsewhere this session — counting per band in the database via
// groupBy avoids ever materializing more than a handful of rows per agent.
const BAND_RANGE: Record<BandKey, { gt?: number; lte?: number }> = {
  band0_500k: { lte: 500_000 },
  band500k_2m: { gt: 500_000, lte: 2_000_000 },
  band2m_5m: { gt: 2_000_000, lte: 5_000_000 },
  band5m_plus: { gt: 5_000_000 },
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id } = await params;

  const byAgent = new Map<string, Record<BandKey, number>>();
  await Promise.all(
    BALANCE_BANDS.map(async (band) => {
      const rows = await prisma.debtor.groupBy({
        by: ['assignedAgentId'],
        where: { fileId: id, assignedAgentId: { not: null }, balance: BAND_RANGE[band.key] },
        _count: { _all: true },
      });
      for (const r of rows) {
        const agentId = r.assignedAgentId!;
        if (!byAgent.has(agentId)) {
          byAgent.set(agentId, Object.fromEntries(BALANCE_BANDS.map((b) => [b.key, 0])) as Record<BandKey, number>);
        }
        byAgent.get(agentId)![band.key] = r._count._all;
      }
    })
  );

  const agentIds = [...byAgent.keys()];
  const agents = agentIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(agents.map((a) => [a.id, a.name]));

  const rows = [...byAgent.entries()].map(([agentId, counts]) => ({
    agentId,
    agentName: nameById.get(agentId) ?? 'Unknown',
    ...counts,
    total: Object.values(counts).reduce((s, n) => s + n, 0),
  }));

  return NextResponse.json({ distribution: rows });
}
