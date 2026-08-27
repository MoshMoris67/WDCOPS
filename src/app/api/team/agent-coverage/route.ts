import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { getAgentCoverageInRange } from '@/lib/debtor-aggregates';

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

// Backs the Team Overview coverage section — how much of each agent's book got worked
// in a chosen window, not just "today" (see the old Agents Today card this replaces).
// Optional agentId/clientId narrow the same rollup to one agent and/or one client's files.
export async function GET(req: Request) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const url = new URL(req.url);
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const agentId = url.searchParams.get('agentId') || undefined;
  const clientId = url.searchParams.get('clientId') || undefined;

  // Default window: today — matches the old "Agents Today" card's scope when no range
  // has been picked yet, so the section isn't empty on first load.
  const from = fromParam ? startOfDay(new Date(fromParam)) : startOfDay(new Date());
  const to = toParam ? endOfDay(new Date(toParam)) : endOfDay(new Date());

  const [coverageRows, agents] = await Promise.all([
    getAgentCoverageInRange({ from, to }, { agentId, clientId }),
    prisma.user.findMany({
      where: { role: { in: ['agent', 'admin'] } },
      select: { id: true, name: true, role: true, status: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const coverageByAgent = new Map(coverageRows.map((r) => [r.agentId, r]));
  // Only list an agent if they actually have a book (optionally scoped to the client
  // filter) — same "don't clutter with permanent 0s" rule team/overview already applies
  // to admins, extended here to every agent so a client filter doesn't leave a wall of
  // untouched-by-this-client rows.
  const rows = agents
    .filter((a) => coverageByAgent.has(a.id))
    .map((a) => {
      const c = coverageByAgent.get(a.id)!;
      return {
        agentId: a.id,
        name: a.name,
        role: a.role,
        status: a.status,
        assignedCount: c.assignedCount,
        contactedCount: c.contactedCount,
        coverageRate: c.assignedCount > 0 ? Math.round((c.contactedCount / c.assignedCount) * 100) : 0,
        callsCount: c.callsCount,
        ptpsCount: c.ptpsCount,
      };
    })
    .sort((a, b) => b.callsCount - a.callsCount);

  return NextResponse.json({ from: from.toISOString(), to: to.toISOString(), agents: rows });
}
