import { NextResponse } from 'next/server';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { buildPerformanceReport, buildAgentReport, buildCompareReport, buildLeaderboard, monthKey } from '@/lib/performance-history';

// Admin-only. ?period=2026-09 | 2026-Q3 (default: this month), optional &clientId= and &fileId=.
//   (default)                      overview: totals, files, agents
//   ?view=agent&agentId=           one agent: trend, rank, files
//   ?view=compare&agentA=&agentB=  two agents head to head
//   ?view=leaderboard              every agent ranked, with movers vs the previous period
export async function GET(req: Request) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const params = new URL(req.url).searchParams;
  const period = params.get('period') || monthKey(new Date());
  const scope = { clientId: params.get('clientId') || undefined, fileId: params.get('fileId') || undefined };
  const view = params.get('view');

  if (view === 'agent') {
    const agentId = params.get('agentId');
    if (!agentId) return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    const report = await buildAgentReport(period, agentId, scope);
    if (!report) return NextResponse.json({ error: 'No performance found for that agent and period' }, { status: 404 });
    return NextResponse.json(report);
  }

  if (view === 'leaderboard') {
    const board = await buildLeaderboard(period, scope);
    if (!board) return NextResponse.json({ error: 'period must look like 2026-09 or 2026-Q3' }, { status: 400 });
    return NextResponse.json(board);
  }

  if (view === 'compare') {
    const a = params.get('agentA');
    const b = params.get('agentB');
    if (!a || !b || a === b) return NextResponse.json({ error: 'Pick two different agents' }, { status: 400 });
    const report = await buildCompareReport(period, a, b, scope);
    if (!report) return NextResponse.json({ error: 'No performance found for those agents and period' }, { status: 404 });
    return NextResponse.json(report);
  }

  const report = await buildPerformanceReport(period, scope);
  if (!report) return NextResponse.json({ error: 'period must look like 2026-09 or 2026-Q3' }, { status: 400 });
  return NextResponse.json(report);
}
