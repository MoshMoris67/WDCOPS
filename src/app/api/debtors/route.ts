import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { computeDebtorStatus } from '@/lib/debtor-status';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const url = new URL(req.url);
  // Agents always see only their own assigned debtors. Admins see the whole branch by
  // default (Team Overview's "All Debtors" relies on this) — except when a caller
  // explicitly asks for their own queue via ?scope=mine, which an admin who also takes
  // calls needs (My Queue) just as much as a plain agent does.
  const mineOnly = url.searchParams.get('scope') === 'mine';
  const where: Prisma.DebtorWhereInput = session.role === 'agent' || mineOnly ? { assignedAgentId: session.sub } : {};

  // The unscoped admin path (Team Overview's All Debtors table) is the one that can be
  // 85,000+ rows — real pagination + server-side filtering there. The scope=mine path is
  // one agent's own queue, already small and indexed, so it keeps returning everything in
  // one response (a generous default pageSize) — AgentDashboardContent needs no changes.
  const search = url.searchParams.get('search')?.trim();
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { loanRef: { contains: search } },
      { phone1: { contains: search } },
    ];
  }
  const clientId = url.searchParams.get('clientId');
  if (clientId) where.file = { clientId };

  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const requestedPageSize = Number(url.searchParams.get('pageSize'));
  // The admin/unscoped path genuinely needs the 100 cap — it's paginating against a
  // table that can be 85,000+ rows. An agent's own queue (scope=mine) is bounded by
  // however many debtors got distributed to one person — capping it at the same 100
  // was the actual bug here: a real 600+-debtor queue was silently truncated to the
  // first 100 (ordered by createdAt), with nothing telling the agent or admin the rest
  // were missing.
  const pageSize = mineOnly
    ? (requestedPageSize > 0 ? Math.min(5000, requestedPageSize) : 5000)
    : Math.min(100, requestedPageSize > 0 ? requestedPageSize : 25);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [total, debtors] = await Promise.all([
    prisma.debtor.count({ where }),
    prisma.debtor.findMany({
      where,
      include: {
        file: { include: { client: true } },
        callLogs: { orderBy: { createdAt: 'desc' }, take: 5 },
        reconciliationEntries: { where: { createdAt: { gte: sevenDaysAgo } }, take: 1 },
      },
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const result = debtors.map((d) => ({
    id: d.id,
    name: d.name,
    phone: d.phone1,
    loanRef: d.loanRef,
    amountOwed: d.amountOwed,
    balance: d.balance,
    client: d.file.client.name,
    recentlyPaid: d.reconciliationEntries.length > 0,
    ...computeDebtorStatus(d.callLogs),
  }));

  return NextResponse.json({ debtors: result, total, page, pageSize });
}
