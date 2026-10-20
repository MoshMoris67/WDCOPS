import { NextResponse } from 'next/server';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { getTeamCommission } from '@/lib/team-commission';

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

  const commission = await getTeamCommission(clientId);
  if (!commission) {
    return NextResponse.json({ enabled: false, buckets: [], agents: [] });
  }

  return NextResponse.json({
    enabled: true,
    buckets: commission.buckets,
    agents: commission.agents,
  });
}
