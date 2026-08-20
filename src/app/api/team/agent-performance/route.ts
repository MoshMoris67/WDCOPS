import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { getFileAgentRecoveredAggregates } from '@/lib/debtor-aggregates';

// Drill-down view, not needed on every dashboard load — kept as its own endpoint
// rather than folded into the already-heavy /api/team/overview.
export async function GET(req: Request) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId');
  const fileId = url.searchParams.get('fileId');
  const agentId = url.searchParams.get('agentId');

  const files = await prisma.file.findMany({
    where: {
      ...(clientId ? { clientId } : {}),
      ...(fileId ? { id: fileId } : {}),
    },
    select: { id: true, batchLabel: true, client: { select: { name: true } } },
  });
  const fileById = new Map(files.map((f) => [f.id, f]));

  const aggregates = await getFileAgentRecoveredAggregates(files.map((f) => f.id));
  const filtered = agentId ? aggregates.filter((a) => a.agentId === agentId) : aggregates;

  const agentIds = [...new Set(filtered.map((a) => a.agentId))];
  const agents = await prisma.user.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } });
  const agentNameById = new Map(agents.map((a) => [a.id, a.name]));

  const rows = filtered
    .map((a) => {
      const f = fileById.get(a.fileId);
      if (!f) return null;
      return {
        fileId: a.fileId,
        batchLabel: f.batchLabel,
        clientName: f.client.name,
        agentId: a.agentId,
        agentName: agentNameById.get(a.agentId) ?? 'Unknown',
        assignedCount: a.assignedCount,
        recovered: a.recovered,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.recovered - a.recovered);

  return NextResponse.json({ rows });
}
