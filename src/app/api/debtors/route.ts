import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/session';
import { computeDebtorStatus } from '@/lib/debtor-status';
import { getRecentCallLogsByDebtor, getRecentlyPaidDebtorIds } from '@/lib/debtor-aggregates';

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
  const fileId = url.searchParams.get('fileId');
  if (fileId) where.fileId = fileId;
  const agentId = url.searchParams.get('agentId');
  if (agentId) where.assignedAgentId = agentId;

  // Lean, unpaginated id-only mode — backs "select all N matching this filter" for bulk
  // reassignment, which needs every matching id (potentially thousands), not a page of
  // full debtor objects. Cheap even at scale since it's a single indexed column, no joins.
  if (url.searchParams.get('idsOnly') === 'true') {
    const ids = await prisma.debtor.findMany({ where, select: { id: true } });
    return NextResponse.json({ ids: ids.map((d) => d.id) });
  }

  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const requestedPageSize = Number(url.searchParams.get('pageSize'));
  // The admin/unscoped path genuinely needs a cap — it's paginating against a table that
  // can be 85,000+ rows. An agent's own queue (scope=mine) gets no cap at all: it's
  // bounded by however many debtors got distributed to one person, and a fixed number
  // here has already been the actual bug twice — first at 100 (a 600+-debtor queue
  // silently truncated), then again once real queues grew past the 5000 that replaced
  // it. No number picked today stays safely ahead of queue sizes as the roster and
  // client base keep growing, so this path just returns everything, always.
  const pageSize = mineOnly ? undefined : Math.min(100, requestedPageSize > 0 ? requestedPageSize : 25);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Fetching each debtor's status used to nest `callLogs: { take: 5 }` and
  // `reconciliationEntries: { take: 1 }` right in this query — fine at normal queue
  // sizes, but a genuinely expensive relation-per-row fetch once one agent's queue
  // reaches into the thousands (found via a real 10,000+-debtor queue timing out the
  // client's fetch). Fetch the flat debtor rows first, then both status inputs for the
  // whole batch in two DB-aggregated queries (debtor-aggregates.ts) instead of one
  // per debtor — same fix pattern already applied to the admin-side views.
  const [total, debtors] = await Promise.all([
    prisma.debtor.count({ where }),
    prisma.debtor.findMany({
      where,
      include: { file: { include: { client: true } } },
      orderBy: { createdAt: 'asc' },
      ...(mineOnly ? {} : { skip: (page - 1) * (pageSize as number), take: pageSize }),
    }),
  ]);

  const debtorIds = debtors.map((d) => d.id);
  const [callLogsByDebtor, recentlyPaidIds] = await Promise.all([
    getRecentCallLogsByDebtor(debtorIds),
    getRecentlyPaidDebtorIds(debtorIds, sevenDaysAgo),
  ]);

  const result = debtors.map((d) => ({
    id: d.id,
    name: d.name,
    phone: d.phone1,
    loanRef: d.loanRef,
    amountOwed: d.amountOwed,
    balance: d.balance,
    client: d.file.client.name,
    recentlyPaid: recentlyPaidIds.has(d.id),
    ...computeDebtorStatus(callLogsByDebtor.get(d.id) ?? []),
  }));

  return NextResponse.json({ debtors: result, total, page, pageSize: pageSize ?? total });
}
